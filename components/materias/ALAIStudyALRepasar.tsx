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

interface ReviewerResult {
  persona: string;
  rating: number;
  verdict: string;
  feedback: string;
  wouldUnderstand: boolean;
  missingForThem?: string[];
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
  masteryStage?: string;
  summary?: string;
  mainIssue?: string;
  scoreReason?: string;
  estimatedNextScore?: number;
  studyBreakdown?: {
    remembered: number;
    explained: number;
    missing: number;
  };
  reviewer?: ReviewerResult | null;
  conceptStatus?: {
    concept: string;
    status: 'mastered' | 'progress' | 'weak';
    note?: string;
  }[];
  strengths: string[];
  missingConcepts: string[];
  confusions: string[];
  weakConcepts?: string[];
  actions?: {
    title: string;
    detail?: string;
  }[];
  teachMissing?: {
    title: string;
    explanation: string;
    example?: string;
    analogy?: string;
  } | null;
  followUpQuestions?: {
    question: string;
    why?: string;
    concept?: string;
  }[];
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

function clampText(text: string, max = 60000) {
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

function normalizePages(value: any): number[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(Number).filter((n) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
  }

  if (value && typeof value === 'object') {
    const start = Number(value.start ?? value.from ?? value.startPage ?? value.paginaInicial);
    const end = Number(value.end ?? value.to ?? value.endPage ?? value.paginaFinal);
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
  }

  return [];
}

function getSelectionPages(item: any): number[] {
  if (!item) return [];
  return [
    item.pages,
    item.selectedPages,
    item.paginasSeleccionadas,
    item.paginas,
    item.pageNumbers,
    item.range,
    item.selection,
  ]
    .map(normalizePages)
    .find((arr) => arr.length > 0) || [];
}

function findSelectionForMaterial(materiales: any[], mat: any, index: number, seleccion?: any[] | null) {
  if (!Array.isArray(seleccion) || !seleccion.length) return null;

  const matMaterialId = String(mat?.materialId || mat?.material_id || mat?.id || '');
  const matDocumentId = String(mat?.id || '');

  return (
    seleccion.find((s: any) => Number(s?.materialIndex) === index) ||
    seleccion.find((s: any) => {
      const ids = [s?.materialId, s?.material_id, s?.documentId, s?.document_id, s?.docId, s?.doc_id, s?.id]
        .filter(Boolean)
        .map((v: any) => String(v));
      return ids.includes(matMaterialId) || ids.includes(matDocumentId);
    }) ||
    seleccion[index] ||
    null
  );
}

function filterTextByPages(fullText: string, pages: number[]): string {
  if (!fullText || !pages.length) return fullText || '';

  const sortedPages = Array.from(new Set(pages.map(Number).filter((n) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
  if (!sortedPages.length) return fullText;

  const result: string[] = [];
  const markerRegex = /(?:^|\n)\s*(?:\[\s*(?:P[aá]gina|Pagina|Page)\s+(\d+)\s*\]|---\s*(?:p[aá]gina|page)\s*(\d+)\s*---)\s*/gi;
  const matches = Array.from(fullText.matchAll(markerRegex));

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const page = Number(match[1] || match[2]);
      if (!sortedPages.includes(page)) continue;

      const start = (match.index || 0) + match[0].length;
      const end = i + 1 < matches.length ? (matches[i + 1].index || fullText.length) : fullText.length;
      const chunk = fullText.slice(start, end).trim();
      if (chunk) result.push(`[Pagina ${page}]\n${chunk}`);
    }

    if (result.length > 0) return result.join('\n\n');
  }

  const pageChunks = fullText.split('\f');
  if (pageChunks.length > 1) {
    for (const page of sortedPages) {
      const chunk = pageChunks[page - 1];
      if (chunk?.trim()) result.push(`[Pagina ${page}]\n${chunk.trim()}`);
    }
  }

  return result.join('\n\n');
}

function scoreLabel(score: number) {
  if (score >= 90) return '🏆 Dominio completo';
  if (score >= 75) return '🎓 Listo para practicar examen';
  if (score >= 55) return '📗 Comprensión sólida';
  if (score >= 35) return '📘 Comprensión básica';
  return '🌱 Idea inicial';
}

function scoreEmoji(score: number) {
  if (score >= 90) return '🏆';
  if (score >= 75) return '🎓';
  if (score >= 55) return '📗';
  if (score >= 35) return '📘';
  return '🌱';
}

function conceptBadge(status: string) {
  if (status === 'mastered') return { icon: '🟢', label: 'Dominado' };
  if (status === 'weak') return { icon: '🔴', label: 'Débil' };
  return { icon: '🟡', label: 'En progreso' };
}

export default function ALAIStudyALRepasar({ materiales, seleccion, tema, materia, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('preview');
  const [notes, setNotes] = useState('');
  const [explanation, setExplanation] = useState('');
  const [mode, setMode] = useState<ExplainMode>('nino');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [followUpAnswer, setFollowUpAnswer] = useState('');
  const [checkingTeach, setCheckingTeach] = useState(false);
  const [teachCheck, setTeachCheck] = useState<any | null>(null);
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
    const blocks = materiales
      .map((m: any, i: number) => {
        const matId = m?.materialId || m?.material_id || m?.id || `material_${i + 1}`;
        const name = m?.nombre || m?.name || m?.titulo || matId;
        const sel = findSelectionForMaterial(materiales, m, i, seleccion);
        const pages = getSelectionPages(sel);
        const selectionText = String((sel as any)?.text || (sel as any)?.texto || (sel as any)?.content || (sel as any)?.contenido || (sel as any)?.selectedText || '').trim();
        const fullText = String(contenidos[m.id] ?? m.contenido ?? '').trim();

        if (selectionText) {
          return `[Material ${i + 1}: ID=${matId} | ${name}${pages.length ? ` | páginas ${pages.join(', ')}` : ''}]\n${selectionText}`;
        }

        if (!fullText) return '';

        if (pages.length > 0) {
          const filtered = filterTextByPages(fullText, pages);
          return `[Material ${i + 1}: ID=${matId} | ${name} | páginas ${pages.join(', ')}]\n${filtered || fullText}`;
        }

        return `[Material ${i + 1}: ID=${matId} | ${name} | documento completo]\n${fullText}`;
      })
      .filter(Boolean);

    if (blocks.length > 0) return blocks.join('\n\n---\n\n');
    return selectedText.trim();
  }, [selectedText, materiales, seleccion, contenidos]);

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
      if (saved?.teachCheck) setTeachCheck(saved.teachCheck);
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
        teachCheck,
        updatedAt: Date.now(),
      }));
    } catch {}
  }, [storageKey, phase, notes, explanation, mode, attempts, analysis, teachCheck]);

  const pendingTeachAnalysis = useMemo(() => {
    if (analysis?.teachMissing) return analysis;
    return attempts.find((attempt) => attempt.analysis?.teachMissing)?.analysis || null;
  }, [analysis, attempts]);

  const mustVerifyMissingConcept = Boolean(pendingTeachAnalysis?.teachMissing && !teachCheck?.passed);

  useEffect(() => {
    if (phase === 'explicar' && mustVerifyMissingConcept) {
      if (!analysis && pendingTeachAnalysis) {
        setAnalysis(pendingTeachAnalysis);
      }

      setPhase('analisis');
      setError('Primero verifica lo que te faltó antes de volver a explicar.');
    }
  }, [phase, mustVerifyMissingConcept, analysis, pendingTeachAnalysis]);

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
    setTeachCheck(null);
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

    if (!materialText.trim()) {
      setError(contentStatus === 'loading'
        ? 'Todavía estoy cargando el contenido del material. Intenta de nuevo en unos segundos.'
        : 'No hay contenido legible del material para comparar tu explicación.');
      return;
    }

    setLoading(true);
    setError('');
    setAnalysis(null);

    try {
      const res = await fetch('/api/alai-studyal-repasar', {
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

  const goToExplain = () => {
    if (mustVerifyMissingConcept) {
      if (!analysis && pendingTeachAnalysis) {
        setAnalysis(pendingTeachAnalysis);
      }

      setPhase('analisis');

      window.setTimeout(() => {
        document
          .getElementById('teach-check-section')
          ?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
      }, 50);

      setError('Primero verifica lo que te faltó antes de volver a explicar.');
      return;
    }

    setError('');
    setPhase('explicar');
  };

  const checkTeachMissing = async () => {
    if (!analysis?.teachMissing) {
      setError('No hay concepto para verificar.');
      return;
    }

    if (!followUpAnswer.trim()) {
      setError('Explícalo con tus palabras antes de verificar.');
      return;
    }

    setCheckingTeach(true);
    setError('');

    try {
      const concept =
        analysis.teachMissing.title ||
        analysis.weakConcepts?.[0] ||
        analysis.missingConcepts?.[0] ||
        'concepto pendiente';

      const lesson = [
        analysis.teachMissing.explanation,
        analysis.teachMissing.example ? `Ejemplo: ${analysis.teachMissing.example}` : '',
        analysis.teachMissing.analogy ? `Analogía: ${analysis.teachMissing.analogy}` : '',
      ].filter(Boolean).join('\n\n');

      const res = await fetch('/api/alai-studyal-repasar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'teach-check',
          mode,
          concept,
          lesson,
          answer: followUpAnswer,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'No se pudo verificar.');

      setTeachCheck(data.check);
    } catch (err: any) {
      setError(err?.message || 'No se pudo verificar.');
    } finally {
      setCheckingTeach(false);
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
                onClick={() => {
                  if (id === 'explicar') {
                    goToExplain();
                    return;
                  }

                  setPhase(id as Phase);
                }}
                style={{
                  border: `2px solid ${active ? 'var(--gold)' : 'var(--border-color)'}`,
                  background: active ? 'color-mix(in srgb, var(--gold) 18%, var(--bg-card))' : 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  borderRadius: 16,
                  padding: '11px 10px',
                  cursor:
                    id === 'explicar' && mustVerifyMissingConcept
                      ? 'not-allowed'
                      : 'pointer',
                  opacity:
                    id === 'explicar' && mustVerifyMissingConcept
                      ? 0.6
                      : 1,
                  fontFamily: HAND,
                  fontSize: 17,
                  fontWeight: 900,
                }}
              >
                {id === 'explicar' && mustVerifyMissingConcept
                  ? `🔒 ${num}. ${label}`
                  : `${num}. ${label}`}
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

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
              <button onClick={() => setPhase('preview')} style={{ ...buttonStyle, background: 'var(--bg-card)', color: 'var(--text-primary)' }}>← prelectura</button>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {analysis?.teachMissing && (
                  <button
                    onClick={() => {
                      if (!analysis && pendingTeachAnalysis) setAnalysis(pendingTeachAnalysis);
                      setPhase('analisis');
                    }}
                    style={{ ...buttonStyle, background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                  >
                    volver a lo que faltó →
                  </button>
                )}
                <button
                  onClick={goToExplain}
                  style={{
                    ...buttonStyle,
                    opacity: mustVerifyMissingConcept ? 0.65 : 1,
                    cursor: mustVerifyMissingConcept ? 'not-allowed' : 'pointer',
                  }}
                >
                  {mustVerifyMissingConcept
                    ? '🔒 verifica antes de explicar'
                    : 'explicar lo entendido →'}
                </button>
              </div>
            </div>
          </div>
        )}
            </div>
          </div>
        ) : null}

        {phase === 'explicar' && (
          <div style={cardStyle}>
            <h2 style={{ fontFamily: HAND, fontSize: 38, margin: '0 0 10px' }}>Di lo que sabes</h2>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.7, fontSize: 16 }}>
              Explica con tus palabras todo lo que recuerdas del material. La IA lo comparará contra el contenido seleccionado completo según el lector que elijas.
            </p>

            <div style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              margin: '18px 0',
            }}>
              {[
                ['nino', 'Niño'],
                ['universitario', 'Universitario'],
                ['profesor', 'Profesor'],
                ['libre', 'Evaluador neutral'],
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
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !loading) {
                  e.preventDefault();
                  evaluate();
                }
              }}
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
              <button onClick={evaluate} disabled={loading || contentStatus === 'loading' || !materialText.trim()} style={{
                ...buttonStyle,
                opacity: loading || contentStatus === 'loading' || !materialText.trim() ? 0.6 : 1,
                cursor: loading || contentStatus === 'loading' ? 'wait' : !materialText.trim() ? 'not-allowed' : 'pointer',
              }}>
                {loading ? 'analizando…' : contentStatus === 'loading' ? 'cargando material…' : 'evaluar con este lector'}
              </button>
            </div>
          </div>
        )}

        {phase === 'analisis' && (
          <div style={cardStyle}>
            <h2 style={{ fontFamily: HAND, fontSize: 38, margin: '0 0 8px' }}>Feedback claro</h2>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 18px', lineHeight: 1.6 }}>
              Esto no califica un ensayo. Mide qué tanto entendiste el material y qué debes mejorar en el siguiente intento.
            </p>

            {!analysis ? (
              <p style={{ color: 'var(--text-muted)' }}>Todavía no hay análisis.</p>
            ) : (
              <div style={{ display: 'grid', gap: 18 }}>
                <div style={{
                  background: 'linear-gradient(135deg, color-mix(in srgb, var(--gold) 16%, var(--bg-primary)), var(--bg-primary))',
                  border: '2px solid var(--gold)',
                  borderRadius: 22,
                  padding: 20,
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 16,
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                  }}>
                    <div style={{ minWidth: 260, flex: 1 }}>
                      <div style={{
                        fontFamily: HAND,
                        fontSize: 38,
                        fontWeight: 900,
                        marginBottom: 6,
                      }}>
                        {scoreLabel(analysis.score)}
                      </div>

                      <p style={{
                        margin: 0,
                        color: 'var(--text-primary)',
                        lineHeight: 1.7,
                        fontSize: 17,
                        fontWeight: 650,
                      }}>
                        {analysis.summary || analysis.feedback || analysis.reviewer?.feedback || 'Análisis generado.'}
                      </p>
                    </div>

                    <div style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 16,
                      padding: '10px 14px',
                      textAlign: 'center',
                      minWidth: 96,
                    }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 900 }}>
                        dominio
                      </div>
                      <div style={{ fontFamily: HAND, fontSize: 30, fontWeight: 900 }}>
                        {analysis.score}/100
                      </div>
                    </div>
                  </div>

                  {analysis.studyBreakdown && (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                      gap: 10,
                      marginTop: 16,
                    }}>
                      {[
                        ['Recordaste', analysis.studyBreakdown.remembered],
                        ['Explicaste', analysis.studyBreakdown.explained],
                        ['Falta reforzar', analysis.studyBreakdown.missing],
                      ].map(([label, value]: any) => (
                        <div key={label} style={{
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 14,
                          padding: 12,
                        }}>
                          <div style={{ fontWeight: 900, marginBottom: 7 }}>{label}</div>
                          <div style={{
                            height: 9,
                            borderRadius: 999,
                            background: 'var(--bg-primary)',
                            overflow: 'hidden',
                            border: '1px solid var(--border-color)',
                          }}>
                            <div style={{
                              width: `${Math.max(0, Math.min(100, Number(value) || 0))}%`,
                              height: '100%',
                              background: 'var(--gold)',
                            }} />
                          </div>
                          <div style={{ marginTop: 6, color: 'var(--text-muted)', fontWeight: 800 }}>{value}%</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(analysis.scoreReason || analysis.mainIssue) && (
                    <div style={{
                      marginTop: 14,
                      color: 'var(--text-muted)',
                      lineHeight: 1.6,
                    }}>
                      <strong>Qué significa:</strong> {analysis.scoreReason || analysis.mainIssue}
                    </div>
                  )}
                </div>

                {(analysis.reviewer || mode) && (
                  <div style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 18,
                    padding: 18,
                  }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      alignItems: 'center',
                      marginBottom: 10,
                    }}>
                      <h3 style={{ fontFamily: HAND, fontSize: 30, margin: 0 }}>
                        Lector: {analysis.reviewer?.persona || (mode === 'nino' ? 'Niño' : mode === 'universitario' ? 'Universitario' : mode === 'profesor' ? 'Profesor' : 'Evaluador neutral')}
                      </h3>
                      <div style={{
                        background: analysis.score >= 75 ? 'var(--gold)' : 'var(--bg-card)',
                        color: analysis.score >= 75 ? '#111' : 'var(--text-primary)',
                        border: '2px solid var(--text-primary)',
                        borderRadius: 999,
                        padding: '6px 12px',
                        fontWeight: 900,
                        fontSize: 14,
                      }}>
                        {analysis.reviewer?.rating ?? analysis.score}/100
                      </div>
                    </div>

                    <p style={{
                      margin: 0,
                      color: 'var(--text-muted)',
                      lineHeight: 1.7,
                    }}>
                      {analysis.reviewer?.feedback || analysis.feedback || 'Este lector evaluó tu explicación según su nivel.'}
                    </p>
                  </div>
                )}

                {Array.isArray(analysis.conceptStatus) && analysis.conceptStatus.length > 0 && (
                  <div style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 18,
                    padding: 18,
                  }}>
                    <h3 style={{ fontFamily: HAND, fontSize: 30, margin: '0 0 12px' }}>Mapa de dominio</h3>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                      gap: 10,
                    }}>
                      {analysis.conceptStatus.map((item, i) => {
                        const badge = conceptBadge(item.status);
                        return (
                          <div key={`${item.concept}-${i}`} style={{
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 14,
                            padding: 12,
                          }}>
                            <div style={{ fontWeight: 900, marginBottom: 5 }}>
                              {badge.icon} {item.concept}
                            </div>
                            <div style={{ color: 'var(--gold)', fontSize: 13, fontWeight: 900, marginBottom: 5 }}>
                              {badge.label}
                            </div>
                            {item.note && (
                              <div style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                {item.note}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: 12,
                }}>
                  <div style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 18,
                    padding: 18,
                  }}>
                    <h3 style={{ fontFamily: HAND, fontSize: 28, margin: '0 0 10px' }}>Ya entendiste</h3>
                    {analysis.strengths?.length ? (
                      <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
                        {analysis.strengths.map((item, i) => <li key={i}>{item}</li>)}
                      </ul>
                    ) : (
                      <p style={{ color: 'var(--text-muted)', margin: 0 }}>Todavía no se detectó una idea fuerte clara.</p>
                    )}
                  </div>

                  <div style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 18,
                    padding: 18,
                  }}>
                    <h3 style={{ fontFamily: HAND, fontSize: 28, margin: '0 0 10px' }}>🎯 Corrige primero</h3>
                    {(analysis.actions?.length ? analysis.actions : [
                      { title: analysis.nextStep || 'Mejora tu siguiente intento', detail: analysis.mainIssue || 'Agrega los conceptos clave que faltaron y conéctalos con tus palabras.' },
                    ]).map((action, i) => (
                      <div key={i} style={{
                        borderTop: i ? '1px solid var(--border-color)' : 'none',
                        paddingTop: i ? 10 : 0,
                        marginTop: i ? 10 : 0,
                      }}>
                        <div style={{ fontWeight: 900 }}>{action.title}</div>
                        {action.detail && (
                          <div style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 4 }}>
                            {action.detail}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {analysis.teachMissing && (analysis.teachMissing.explanation || analysis.teachMissing.example || analysis.teachMissing.analogy) && (
                  <div style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 18,
                    padding: 18,
                  }}>
                    <h3 style={{ fontFamily: HAND, fontSize: 30, margin: '0 0 10px' }}>
                      Lo que te faltó, explicado aquí mismo
                    </h3>

                    {analysis.teachMissing.title && (
                      <div style={{
                        color: 'var(--gold)',
                        fontWeight: 900,
                        marginBottom: 8,
                      }}>
                        {analysis.teachMissing.title}
                      </div>
                    )}

                    {analysis.teachMissing.explanation && (
                      <p style={{ margin: 0, color: 'var(--text-primary)', lineHeight: 1.7 }}>
                        {analysis.teachMissing.explanation}
                      </p>
                    )}

                    {analysis.teachMissing.example && (
                      <div style={{
                        marginTop: 12,
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 14,
                        padding: 12,
                        lineHeight: 1.6,
                      }}>
                        <strong>Ejemplo:</strong> {analysis.teachMissing.example}
                      </div>
                    )}

                    {analysis.teachMissing.analogy && (
                      <div style={{
                        marginTop: 10,
                        color: 'var(--text-muted)',
                        lineHeight: 1.6,
                      }}>
                        <strong>Analogía:</strong> {analysis.teachMissing.analogy}
                      </div>
                    )}
                  </div>
                )}

                {(analysis.missingConcepts?.length > 0 || analysis.confusions?.length > 0) && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: 12,
                  }}>
                    {analysis.missingConcepts?.length > 0 && (
                      <div style={{
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 18,
                        padding: 18,
                      }}>
                        <h3 style={{ fontFamily: HAND, fontSize: 28, margin: '0 0 10px' }}>🧩 Faltó mencionar</h3>
                        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
                          {analysis.missingConcepts.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                      </div>
                    )}

                    {analysis.confusions?.length > 0 && (
                      <div style={{
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 18,
                        padding: 18,
                      }}>
                        <h3 style={{ fontFamily: HAND, fontSize: 28, margin: '0 0 10px' }}>⚠️ Revisa esto</h3>
                        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
                          {analysis.confusions.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {analysis.teachMissing && (analysis.teachMissing.explanation || Array.isArray(analysis.followUpQuestions)) && (
                  <div style={{
                    background: 'color-mix(in srgb, var(--gold) 9%, var(--bg-primary))',
                    border: '1px solid var(--gold)',
                    borderRadius: 18,
                    padding: 18,
                  }}>
                    <div id="teach-check-section">
                    <h3 style={{ fontFamily: HAND, fontSize: 30, margin: '0 0 8px' }}>
                      Explícalo tú para verificar
                    </h3>
                    <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                      Antes de reintentar todo el material, demuestra que ya entendiste lo que te faltó.
                    </p>

                    {Array.isArray(analysis.followUpQuestions) && analysis.followUpQuestions.length > 0 && (
                      <div style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 14,
                        padding: 14,
                        marginBottom: 12,
                      }}>
                        <div style={{ fontWeight: 900, lineHeight: 1.5 }}>
                          {typeof analysis.followUpQuestions[0] === 'string'
                            ? analysis.followUpQuestions[0]
                            : analysis.followUpQuestions[0].question}
                        </div>

                        {typeof analysis.followUpQuestions[0] !== 'string' && analysis.followUpQuestions[0].concept && (
                          <div style={{
                            marginTop: 6,
                            display: 'inline-block',
                            color: '#111',
                            background: 'var(--gold)',
                            borderRadius: 999,
                            padding: '3px 9px',
                            fontSize: 12,
                            fontWeight: 900,
                          }}>
                            {analysis.followUpQuestions[0].concept}
                          </div>
                        )}
                      </div>
                    )}

                    <textarea
                      value={followUpAnswer}
                      onChange={(e) => {
                        setFollowUpAnswer(e.target.value);
                        setTeachCheck(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();

                          if (teachCheck?.passed) {
                            setError('');
                            setPhase('explicar');
                            return;
                          }

                          if (followUpAnswer.trim() && !checkingTeach) {
                            checkTeachMissing();
                          }
                        }
                      }}
                      placeholder="Explícalo aquí con tus palabras... Enter para verificar, Shift+Enter para nueva línea"
                      style={{
                        width: '100%',
                        minHeight: 150,
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
                        marginTop: 12,
                      }}
                    />

                    {teachCheck && (
                      <div style={{
                        marginTop: 12,
                        background: teachCheck.passed
                          ? 'color-mix(in srgb, var(--gold) 14%, var(--bg-card))'
                          : 'var(--bg-card)',
                        border: teachCheck.passed
                          ? '1px solid var(--gold)'
                          : '1px solid var(--border-color)',
                        borderRadius: 14,
                        padding: 14,
                        lineHeight: 1.6,
                      }}>
                        <div style={{
                          fontWeight: 900,
                          marginBottom: 6,
                          color: teachCheck.passed ? 'var(--gold)' : '#f87171',
                        }}>
                          {teachCheck.passed ? '✅ Ya entendiste este concepto' : '🟡 Casi, pero falta ajustar'}
                        </div>

                        {teachCheck.message && (
                          <div style={{ color: 'var(--text-primary)' }}>
                            {teachCheck.message}
                          </div>
                        )}

                        {Array.isArray(teachCheck.stillMissing) && teachCheck.stillMissing.length > 0 && (
                          <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: 'var(--text-muted)' }}>
                            {teachCheck.stillMissing.map((item: string, i: number) => <li key={i}>{item}</li>)}
                          </ul>
                        )}

                        {teachCheck.improvedAnswer && (
                          <div style={{ marginTop: 10, color: 'var(--text-muted)' }}>
                            <strong>Mejor forma de decirlo:</strong> {teachCheck.improvedAnswer}
                          </div>
                        )}
                      </div>
                    )}

                    {error && (
                      <div style={{
                        marginTop: 12,
                        color: '#f87171',
                        fontWeight: 800,
                      }}>
                        {error}
                      </div>
                    )}

                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      marginTop: 14,
                      flexWrap: 'wrap',
                    }}>
                      <button
                        onClick={() => setPhase('lectura')}
                        style={{ ...buttonStyle, background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                      >
                        ← releer material
                      </button>

                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <button
                          onClick={checkTeachMissing}
                          disabled={!followUpAnswer.trim() || checkingTeach}
                          style={{
                            ...buttonStyle,
                            background: 'var(--bg-card)',
                            color: 'var(--text-primary)',
                            opacity: followUpAnswer.trim() && !checkingTeach ? 1 : 0.5,
                            cursor: followUpAnswer.trim() && !checkingTeach ? 'pointer' : 'not-allowed',
                          }}
                        >
                          {checkingTeach ? 'verificando…' : 'verificar concepto'}
                        </button>

                        <button
                          onClick={() => {
                            if (!teachCheck?.passed) {
                              document
                                .getElementById('teach-check-section')
                                ?.scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'start',
                                });

                              setError(
                                'Primero verifica que entendiste el concepto faltante.'
                              );

                              return;
                            }

                            if (!followUpAnswer.trim()) {
                              setError('Explícalo con tus palabras antes de reintentar.');
                              return;
                            }

                            setExplanation((prev) =>
                              `${prev.trim()}\n\nLo que aprendí después del feedback:\n${followUpAnswer.trim()}`.trim()
                            );

                            setError('');
                            setPhase('explicar');
                          }}
                          disabled={!teachCheck?.passed}
                          style={{
                            ...buttonStyle,
                            opacity: teachCheck?.passed ? 1 : 0.5,
                            cursor: teachCheck?.passed ? 'pointer' : 'not-allowed',
                          }}
                        >
                          {teachCheck?.passed
                            ? '✅ volver a explicar →'
                            : '🔒 verifica antes de volver a explicar'}
                        </button>
                      </div>
                    </div>
                    </div>
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
                          <strong>Intento {attempts.length - index}</strong> · {attempt.analysis.score}/100 · {scoreLabel(attempt.analysis.score)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 22 }}>
              <button
                onClick={goToExplain}
                style={{
                  ...buttonStyle,
                  background: mustVerifyMissingConcept ? 'var(--bg-card)' : 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  opacity: mustVerifyMissingConcept ? 0.65 : 1,
                }}
              >
                {mustVerifyMissingConcept
                  ? '🔒 verifica antes de volver a explicar'
                  : '← volver a explicar'}
              </button>
              <button onClick={onBack} style={buttonStyle}>terminar repaso</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
