'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useMasteryReporter } from '../../hooks/useMastery';
import dynamic from 'next/dynamic';
import { buildSourceSelectionFromMaterials, type SourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';
import { useAuthorizedSource } from '../../lib/materials/useAuthorizedSource';
import { sourceScopedKey } from '../../lib/materials/authorizedSource';
import { getSessionById } from '../../lib/studySessions';
import { readFreeToolState, writeFreeToolState } from '../../lib/freeToolState';

const PDFViewer = dynamic(() => import('./FlashcardsPDFViewer'), { ssr: false });

const BODY = "'Inter', system-ui, sans-serif";
const SERIF = "'Times New Roman', Georgia, serif";

type QuestionType = 'short_answer' | 'open_response' | 'multiple_choice' | 'true_false' | 'matching' | 'fill_blank' | 'case_application';
type Skill = 'retention' | 'comprehension' | 'application' | 'relation' | 'explanation' | 'critical_thinking';
type Difficulty = 'basic' | 'medium' | 'advanced';
type Confidence = 'guess' | 'low' | 'high' | 'very_high';

interface ExamQuestion {
  id: string; section: string; type: QuestionType; prompt: string; points: number;
  options?: string[]; correctAnswer?: any; expectedAnswer?: string; rubricHints?: string[];
  sourceMaterial?: string; sourceMaterialName?: string; sourcePage?: number;
  skill: Skill; difficulty: Difficulty; pairs?: { left: string; right: string }[];
  wordBank?: string[];
}

interface ExamSection { id: string; title: string; }
interface GeneratedExam {
  id: string; title: string; totalPoints: number; estimatedDifficulty: Difficulty;
  coverage: string; sections: ExamSection[]; questions: ExamQuestion[];
}

interface PerQuestionResult {
  index: number; correct: boolean; partialScore: number; feedback: string; modelAnswer: string;
}

interface Evaluation {
  score: number;
  skillScores: Record<Skill, number>;
  perQuestion?: PerQuestionResult[];
  strengths: string[]; weaknesses: string[];
  masteredConcepts: string[]; weakConcepts: string[];
  weakPages: number[]; passProbability: number;
  gradeProbabilities?: { A: number; B: number; C: number; fail: number };
  recommendation: string;
  recoveryPlan: { title: string; detail: string }[];
}

interface PersistedExamState {
  phase: Phase;
  duration: number;
  recommendedMinutes: number | null;
  examMode: 'closed' | 'open';
  adaptive: boolean;
  exam: GeneratedExam | null;
  currentQuestion: number;
  answers: any[];
  confidences: (Confidence | null)[];
  draftAnswer: any;
  draftConfidence: Confidence | null;
  marked: number[];
  deadlineAt: number | null;
  paused: boolean;
  remainingSeconds: number;
  questionTimes: number[];
  evaluation: Evaluation | null;
  submissionError: string;
  pendingSubmissionAnswers: any[] | null;
  pendingSubmissionConfidences: (Confidence | null)[] | null;
  resultsTab: 'overview' | 'questions' | 'calibration';
}

interface Props {
  materiales: any[]; seleccion?: any[] | null;
  tema: any; materia: any; onBack: () => void;
  userName?: string;
  onMasteryEvent?: (event: any) => void;
  masteryContext?: any;
  sessionId?: string | null;
  sourceSelection?: SourceSelectionSnapshot;
}

type Phase = 'setup' | 'generating' | 'exam' | 'evaluating' | 'results';

const SKILL_LABEL: Record<Skill, string> = {
  retention: 'Retención', comprehension: 'Comprensión', application: 'Aplicación',
  relation: 'Relaciones', explanation: 'Explicación', critical_thinking: 'Pensamiento crítico',
};
const SKILL_ICON: Record<Skill, string> = {
  retention: '🧠', comprehension: '💡', application: '⚙️',
  relation: '🔗', explanation: '✏️', critical_thinking: '🎯',
};
const TYPE_LABEL: Record<QuestionType, string> = {
  short_answer: 'Respuesta corta', open_response: 'Desarrollo', multiple_choice: 'Opción múltiple',
  true_false: 'Verdadero / Falso', matching: 'Relacionar', fill_blank: 'Completar', case_application: 'Caso aplicado',
};
const CONFIDENCE_LABEL: Record<Confidence, string> = {
  guess: 'Adiviné', low: 'Poco seguro', high: 'Seguro', very_high: 'Muy seguro',
};
const CONFIDENCE_ICON: Record<Confidence, string> = {
  guess: '🎲', low: '🤔', high: '👍', very_high: '💪',
};

function defaultAnswerFor(type: QuestionType): any {
  if (type === 'multiple_choice' || type === 'true_false') return null;
  if (type === 'matching') return {};
  return '';
}

function isAnswered(v: any): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length >= 1;
  if (typeof v === 'number' || typeof v === 'boolean') return true;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return false;
}

function normalize(s: string): string {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

// Local auto-grade rápido para alimentar adaptación
function quickGrade(q: ExamQuestion, ans: any): boolean | null {
  if (q.type === 'multiple_choice') return ans === q.correctAnswer;
  if (q.type === 'true_false') return ans === q.correctAnswer;
  if (q.type === 'fill_blank') return normalize(String(ans || '')) === normalize(String(q.expectedAnswer || ''));
  if (q.type === 'matching') {
    const pairs = q.pairs || [];
    const map = typeof ans === 'object' ? ans : {};
    return pairs.length > 0 && pairs.every((_, i) => map[i] === i);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
export default function ALAIStudyALExams({ materiales, seleccion, tema, materia, onBack, userName, onMasteryEvent, masteryContext, sessionId, sourceSelection }: Props) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [duration, setDuration] = useState(30);
  const [recommendedMinutes, setRecommendedMinutes] = useState<number | null>(null);
  const [examMode, setExamMode] = useState<'closed' | 'open'>('closed');
  const [adaptive, setAdaptive] = useState(true);

  const [materialText, setMaterialText] = useState('');
  const [loadingText, setLoadingText] = useState(false);
  const [genError, setGenError] = useState('');

  const [exam, setExam] = useState<GeneratedExam | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<any[]>([]);
  const [confidences, setConfidences] = useState<(Confidence | null)[]>([]);
  const [draftAnswer, setDraftAnswer] = useState<any>('');
  const [draftConfidence, setDraftConfidence] = useState<Confidence | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(30 * 60);
  const [turning, setTurning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [adapting, setAdapting] = useState(false);
  const [showSignModal, setShowSignModal] = useState(false);
  const [signConfirmed, setSignConfirmed] = useState(false);

  // TIEMPO POR PREGUNTA
  const [questionTimes, setQuestionTimes] = useState<number[]>([]);
  const questionStartRef = useRef<number>(Date.now());

  // PDF VIEWER LATERAL
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [showPdf, setShowPdf] = useState(true);
  const [activeMaterialIndex, setActiveMaterialIndex] = useState(0);

  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [continuityReady, setContinuityReady] = useState(false);
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  const [submissionError, setSubmissionError] = useState('');
  const [pendingSubmissionAnswers, setPendingSubmissionAnswers] = useState<any[] | null>(null);
  const [pendingSubmissionConfidences, setPendingSubmissionConfidences] = useState<(Confidence | null)[] | null>(null);
  const generationBusyRef = useRef(false);
  const generationAttemptRef = useRef(0);
  const generationControllerRef = useRef<AbortController | null>(null);
  const evaluationBusyRef = useRef(false);
  const evaluationAttemptRef = useRef(0);
  const evaluationControllerRef = useRef<AbortController | null>(null);
  const [genStep, setGenStep] = useState(0);
  const [resultsTab, setResultsTab] = useState<'overview' | 'questions' | 'calibration'>('overview');

  const { reportEvent } = useMasteryReporter();
  const paperRef = useRef<HTMLDivElement | null>(null);
  const effectiveSourceSelection = useMemo(
    () => sourceSelection || buildSourceSelectionFromMaterials(materiales, seleccion),
    [sourceSelection, materiales, seleccion],
  );
  const { result: authorizedSource, status: authorizedStatus, error: authorizedError } = useAuthorizedSource(effectiveSourceSelection);
  const storageKey = useMemo(() => sourceScopedKey('studyal_exam_autosave_v4', effectiveSourceSelection, {
    temaId: tema?.id || tema?.nombre,
    sessionId,
  }), [effectiveSourceSelection.fingerprint, tema?.id, tema?.nombre, sessionId]);

  const materialNames = useMemo(() =>
    materiales?.map((m: any) => m?.titulo || m?.nombre || m?.name || 'Material').slice(0, 8) || []
  , [materiales]);

  const selectedPagesArr = useMemo(() => {
    return Array.from(new Set<number>(
      effectiveSourceSelection.materials.flatMap(item => item.selectedPages)
        .map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
    )).sort((a, b) => a - b);
  }, [effectiveSourceSelection]);

  const selectedPagesLabel = useMemo(() => {
    if (!selectedPagesArr.length) return 'Todo el material';
    if (selectedPagesArr.length <= 10) return `Págs ${selectedPagesArr.join(', ')}`;
    return `${selectedPagesArr.length} páginas`;
  }, [selectedPagesArr]);

  const today = useMemo(() => new Date().toLocaleDateString('es-PA', { day: '2-digit', month: 'long', year: 'numeric' }), []);
  const examCode = useMemo(() => {
    const raw = `${tema?.id || tema?.nombre || 'T'}-${Date.now()}`;
    let h = 0; for (let i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
    return `ALAI-${Math.abs(h).toString().slice(0, 6).padStart(6, '0')}`;
  }, [tema]);

  const questions = exam?.questions || [];
  const answeredCount = answers.filter(isAnswered).length;
  const progress = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;
  const mins = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const secs = String(remainingSeconds % 60).padStart(2, '0');
  const timePercent = exam ? remainingSeconds / (duration * 60) : 1;
  const timeColor = timePercent > 0.5 ? '#f5c842' : timePercent > 0.25 ? '#f59e0b' : timePercent > 0.1 ? '#ef4444' : '#dc2626';

  const genSteps = [
    { icon: '📄', label: 'Leyendo material' }, { icon: '🔍', label: 'Extrayendo conceptos' },
    { icon: '⚖️', label: 'Calculando dificultad' }, { icon: '🗂', label: 'Diseñando secciones' },
    { icon: '✏️', label: 'Generando preguntas' }, { icon: '✓', label: 'Preparando examen' },
  ];

  // ─── HELPERS ─────────────────────────────────────────────────
  const getSelectionPages = useCallback((item: any): number[] => {
    if (!item) return [];
    const candidates = [item?.pages, item?.paginasSeleccionadas, item?.selectedPages, item?.paginas];
    for (const value of candidates) {
      if (Array.isArray(value)) {
        const arr = Array.from(new Set(value.map(Number).filter((n: number) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
        if (arr.length > 0) return arr;
      }
    }
    return [];
  }, []);

  const filterTextByPages = useCallback((fullText: string, pages: number[]): string => {
    if (!pages.length) return fullText;
    const sorted = [...pages].sort((a, b) => a - b);
    const lines = fullText.split('\n');
    const result: string[] = [];
    let capturing = false;
    for (const line of lines) {
      const m = line.match(/\[(?:Pagina|Página|Page)\s*(\d+)\]/i);
      if (m) { capturing = sorted.includes(parseInt(m[1], 10)); if (capturing) result.push(line); continue; }
      if (capturing) result.push(line);
    }
    if (!result.length) {
      const chunks = fullText.split('\f');
      for (const pg of sorted) { const c = chunks[pg - 1]; if (c?.trim()) result.push(`[Pagina ${pg}]\n${c.trim()}`); }
    }
    return result.join('\n');
  }, []);

  // ─── LOAD MATERIAL ───────────────────────────────────────────
  useEffect(() => {
    if (authorizedStatus === 'loading' || authorizedStatus === 'idle') {
      setLoadingText(true);
      return;
    }
    setLoadingText(false);
    if (authorizedStatus === 'error' || !authorizedSource) {
      setGenError(authorizedError || 'No se pudo resolver la fuente autorizada.');
      setMaterialText('');
      return;
    }
    setGenError('');
    setMaterialText(authorizedSource.combinedText);
    calcRecommended(authorizedSource.combinedText);
  }, [authorizedStatus, authorizedSource, authorizedError]);

  function calcRecommended(text: string) {
    const chars = text.length;
    const pages = selectedPagesArr.length || Math.max(1, Math.round(chars / 2500));
    const raw = (chars / 1500) + (pages * 2);
    const rec = raw < 25 ? 10 : raw < 55 ? 20 : raw < 110 ? 30 : raw < 200 ? 45 : 60;
    setRecommendedMinutes(rec);
    setDuration(rec);
  }

  // ─── TIMER ──────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'exam' || paused || !deadlineAt) return;
    const updateClock = () => {
      const next = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
      setRemainingSeconds(next);
      if (next <= 0 && !evaluationBusyRef.current) submitExam();
    };
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, [phase, paused, deadlineAt]);

  // ─── GLOBAL ENTER LISTENER — captura Enter en TODOS los tipos ──
  useEffect(() => {
    if (phase !== 'exam') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      if (pendingConfRef.current) return;
      if (turningRef.current) return;
      if (!canAdvanceRef.current) return;

      const target = e.target as HTMLElement;
      const tag = target?.tagName;

      // En TEXTAREA, Shift+Enter = salto de línea (no avanzar)
      if (tag === 'TEXTAREA' && e.shiftKey) return;

      e.preventDefault();
      e.stopPropagation();

      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') {
        (target as HTMLElement).blur();
      }

      // Llamar SIEMPRE a la última versión de nextQuestion
      window.setTimeout(() => nextQuestionRef.current(), 30);
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [phase]);

  // ─── PDF LOADER ─────────────────────────────────────────────
  const matActual = materiales?.[activeMaterialIndex] ?? materiales?.[0];
  const matActualId = matActual?.materialId || matActual?.id || null;
  const activeMaterialSelectedPages = matActualId
    ? (effectiveSourceSelection.selectedPages[String(matActualId)] || [])
    : [];

  useEffect(() => {
    if (!matActualId || phase !== 'exam') { setPdfUrl(null); return; }
    let cancelled = false;
    setPdfLoading(true); setPdfUrl(null);
    (async () => {
      try {
        const res = await fetch('/api/materials/' + matActualId + '/download-url', { credentials: 'same-origin' });
        const data = await res.json();
        if (!cancelled && data?.url) setPdfUrl(data.url);
      } catch {} finally { if (!cancelled) setPdfLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [matActualId, phase]);

  // Cambiar PDF cuando la pregunta cambia de material
  useEffect(() => {
    if (phase !== 'exam' || !exam) return;
    const q = exam.questions[currentQuestion];
    if (!q?.sourceMaterial) return;
    const idx = materiales.findIndex((m: any) => (m.materialId || m.id) === q.sourceMaterial);
    if (idx >= 0 && idx !== activeMaterialIndex) setActiveMaterialIndex(idx);
  }, [phase, exam, currentQuestion, materiales, activeMaterialIndex]);

  // ─── GEN STEPS ──────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'generating') return;
    setGenStep(0);
    const t = window.setInterval(() => setGenStep(s => Math.min(s + 1, genSteps.length - 1)), 2200);
    return () => window.clearInterval(t);
  }, [phase]);

  // ─── RESTORE + EVENT-DRIVEN AUTO-SAVE ──────────────────────
  useEffect(() => {
    const durable = readFreeToolState<PersistedExamState>(sessionId, effectiveSourceSelection.fingerprint, 'exam');
    let saved = durable?.state || null;
    if (!saved && sessionId) {
      const legacy = (getSessionById(sessionId) as any)?.notes?.freeExam;
      if (legacy?.sourceSelectionFingerprint === effectiveSourceSelection.fingerprint && legacy.exam) {
        saved = {
          phase: 'exam', duration, recommendedMinutes: null, examMode: 'closed', adaptive: true,
          exam: legacy.exam, currentQuestion: Number(legacy.currentQuestion || 0),
          answers: Array.isArray(legacy.answers) ? legacy.answers : [],
          confidences: Array.isArray(legacy.confidences) ? legacy.confidences : [],
          draftAnswer: legacy.answers?.[legacy.currentQuestion] ?? '', draftConfidence: legacy.confidences?.[legacy.currentQuestion] ?? null,
          marked: Array.isArray(legacy.marked) ? legacy.marked : [], deadlineAt: null,
          paused: false, remainingSeconds: Number(legacy.remainingSeconds || duration * 60),
          questionTimes: [], evaluation: null, submissionError: '', pendingSubmissionAnswers: null,
          pendingSubmissionConfidences: null, resultsTab: 'overview',
        };
      }
    }
    if (saved?.exam) {
      setDuration(Number(saved.duration || 30));
      setRecommendedMinutes(saved.recommendedMinutes ?? null);
      setExamMode(saved.examMode || 'closed');
      setAdaptive(saved.adaptive !== false);
      setExam(saved.exam);
      setCurrentQuestion(Math.max(0, Number(saved.currentQuestion || 0)));
      setAnswers(Array.isArray(saved.answers) ? saved.answers : []);
      setConfidences(Array.isArray(saved.confidences) ? saved.confidences : []);
      setDraftAnswer(saved.draftAnswer ?? defaultAnswerFor(saved.exam.questions?.[saved.currentQuestion || 0]?.type));
      setDraftConfidence(saved.draftConfidence ?? null);
      setMarked(new Set(Array.isArray(saved.marked) ? saved.marked : []));
      setDeadlineAt(saved.deadlineAt || (Date.now() + Math.max(0, Number(saved.remainingSeconds || 0)) * 1000));
      setPaused(saved.paused === true || saved.phase === 'evaluating');
      setRemainingSeconds(Math.max(0, saved.deadlineAt && saved.paused !== true
        ? Math.ceil((saved.deadlineAt - Date.now()) / 1000)
        : Number(saved.remainingSeconds || 0)));
      setQuestionTimes(Array.isArray(saved.questionTimes) ? saved.questionTimes : []);
      setEvaluation(saved.evaluation || null);
      setSubmissionError(saved.phase === 'evaluating'
        ? 'La corrección anterior se interrumpió. Reintenta sin regenerar el examen.'
        : String(saved.submissionError || ''));
      setPendingSubmissionAnswers(saved.pendingSubmissionAnswers || null);
      setPendingSubmissionConfidences(saved.pendingSubmissionConfidences || null);
      setResultsTab(saved.resultsTab || 'overview');
      setPhase(saved.phase === 'evaluating' ? 'exam' : saved.phase);
    }
    setContinuityReady(true);
  }, [sessionId, effectiveSourceSelection.fingerprint]);

  useEffect(() => {
    if (!continuityReady || !sessionId || !exam) return;
    const timer = window.setTimeout(() => {
      const state: PersistedExamState = {
        phase, duration, recommendedMinutes, examMode, adaptive, exam, currentQuestion,
        answers, confidences, draftAnswer, draftConfidence, marked: [...marked], deadlineAt,
        paused, remainingSeconds, questionTimes, evaluation, submissionError,
        pendingSubmissionAnswers, pendingSubmissionConfidences, resultsTab,
      };
      writeFreeToolState(sessionId, effectiveSourceSelection.fingerprint, 'exam', state);
      try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {}
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    continuityReady, sessionId, effectiveSourceSelection.fingerprint, phase, duration,
    recommendedMinutes, examMode, adaptive, exam, currentQuestion, answers, confidences,
    draftAnswer, draftConfidence, marked, deadlineAt, paused, questionTimes, evaluation,
    submissionError, pendingSubmissionAnswers, pendingSubmissionConfidences, resultsTab, storageKey,
  ]);

  useEffect(() => () => {
    generationAttemptRef.current += 1;
    generationControllerRef.current?.abort();
    evaluationAttemptRef.current += 1;
    evaluationControllerRef.current?.abort();
  }, []);

  // ─── GENERATE ───────────────────────────────────────────────
  async function generateExam() {
    if (!materialText.trim()) { setGenError('No hay texto del material.'); return; }
    if (generationBusyRef.current) return;
    generationBusyRef.current = true;
    const attempt = ++generationAttemptRef.current;
    generationControllerRef.current?.abort();
    const controller = new AbortController();
    generationControllerRef.current = controller;
    setPhase('generating'); setGenError('');
    try {
      const res = await fetch('/api/alai-studyal-exam', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          mode: 'generate', materialText, materia: materia?.nombre || '',
          tema: tema?.nombre || '', selectedPages: selectedPagesArr,
          selectedPagesByMaterial: effectiveSourceSelection.selectedPages,
          sourceSelectionFingerprint: effectiveSourceSelection.fingerprint,
          durationMinutes: duration, masteryContext,
        }),
      });
      const data = await res.json();
      if (controller.signal.aborted || generationAttemptRef.current !== attempt) return;
      if (!res.ok || !data.success) throw new Error(data.error || `Error ${res.status}`);
      if (!data.exam?.questions?.length) throw new Error('ALAI no generó preguntas.');

      const newExam = data.exam as GeneratedExam;
      setExam(newExam);
      if (data.recommendedMinutes) setRecommendedMinutes(data.recommendedMinutes);
      setAnswers(newExam.questions.map(q => defaultAnswerFor(q.type)));
      setConfidences(newExam.questions.map(() => null));
      setQuestionTimes(newExam.questions.map(() => 0));
      questionStartRef.current = Date.now();
      setDraftAnswer(defaultAnswerFor(newExam.questions[0]?.type));
      setDraftConfidence(null);
      setCurrentQuestion(0);
      setRemainingSeconds(duration * 60);
      setDeadlineAt(Date.now() + duration * 60 * 1000);
      setMarked(new Set());
      setEvaluation(null);
      setSubmissionError('');
      setPendingSubmissionAnswers(null);
      setPendingSubmissionConfidences(null);
      setPhase('exam');
      window.setTimeout(() => paperRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    } catch (err: any) {
      if (controller.signal.aborted || generationAttemptRef.current !== attempt) return;
      setGenError(err?.message || 'No se pudo generar el examen.');
      setPhase('setup');
    } finally {
      if (generationAttemptRef.current === attempt) {
        generationBusyRef.current = false;
        generationControllerRef.current = null;
      }
    }
  }

  // ─── ADAPTACIÓN DINÁMICA ────────────────────────────────────
  const lastAdaptedAt = useRef(0);
  async function maybeAdapt() {
    if (!adaptive || !exam) return;
    // Solo cada 4 preguntas y si quedan al menos 25% de tiempo
    if (currentQuestion < 3 || (currentQuestion - lastAdaptedAt.current) < 4) return;
    if (remainingSeconds < duration * 60 * 0.25) return;
    if (questions.length - currentQuestion > 8) return; // ya hay suficientes

    // Calcular rendimiento por skill
    const skillPerf: Record<string, { correct: number; total: number }> = {};
    let recentCorrect = 0, recentTotal = 0;
    const recentN = Math.min(5, currentQuestion + 1);
    for (let i = 0; i <= currentQuestion; i++) {
      const q = questions[i];
      const ans = i === currentQuestion ? draftAnswer : answers[i];
      const grade = quickGrade(q, ans);
      if (grade === null) continue;
      if (!skillPerf[q.skill]) skillPerf[q.skill] = { correct: 0, total: 0 };
      skillPerf[q.skill].total += 1;
      if (grade) skillPerf[q.skill].correct += 1;
      if (i > currentQuestion - recentN) {
        recentTotal += 1;
        if (grade) recentCorrect += 1;
      }
    }
    const recentRate = recentTotal ? recentCorrect / recentTotal : 0.5;

    setAdapting(true);
    try {
      const res = await fetch('/api/alai-studyal-exam', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'adapt',
          exam,
          answeredQuestions: questions.slice(0, currentQuestion + 1),
          skillPerformance: skillPerf,
          recentCorrectRate: recentRate,
          materialText,
          materia: materia?.nombre || '',
          tema: tema?.nombre || '',
          count: 3,
          askedPrompts: questions.map(q => q.prompt),
        }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.newQuestions) && data.newQuestions.length) {
        setExam(prev => prev ? { ...prev, questions: [...prev.questions, ...data.newQuestions] } : prev);
        setAnswers(prev => [...prev, ...data.newQuestions.map((q: ExamQuestion) => defaultAnswerFor(q.type))]);
        setConfidences(prev => [...prev, ...data.newQuestions.map(() => null)]);
        lastAdaptedAt.current = currentQuestion;
      }
    } catch (e) {
      console.warn('adapt failed', e);
    } finally {
      setAdapting(false);
    }
  }

  // ─── NAV ────────────────────────────────────────────────────
  function saveDraft(idx: number, val: any, conf?: Confidence | null) {
    setAnswers(prev => { const n = [...prev]; n[idx] = val; return n; });
    if (conf !== undefined) {
      setConfidences(prev => { const n = [...prev]; n[idx] = conf; return n; });
    }
  }

  function goTo(targetIdx: number) {
    if (!exam || targetIdx < 0 || targetIdx >= exam.questions.length) return;
    // Registrar tiempo en pregunta actual
    const elapsedMs = Date.now() - questionStartRef.current;
    setQuestionTimes(prev => {
      const n = [...prev];
      n[currentQuestion] = (n[currentQuestion] || 0) + elapsedMs;
      return n;
    });
    saveDraft(currentQuestion, draftAnswer, draftConfidence);
    setTurning(true);
    window.setTimeout(() => {
      setCurrentQuestion(targetIdx);
      setDraftAnswer(answers[targetIdx] ?? defaultAnswerFor(exam.questions[targetIdx].type));
      setDraftConfidence(confidences[targetIdx] ?? null);
      questionStartRef.current = Date.now();
      setTurning(false);
      paperRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 400);
  }

  function nextQuestion() {
    if (!exam) return;
    if (!isAnswered(draftAnswer)) return;
    saveDraft(currentQuestion, draftAnswer);
    const action = currentQuestion < exam.questions.length - 1 ? 'next' : 'submit';
    setPendingConfidence({ questionIdx: currentQuestion, nextAction: action });
    if (confTimerRef.current) window.clearTimeout(confTimerRef.current);
    confTimerRef.current = window.setTimeout(() => {
      finalizeConfidence('low');
    }, 10000);
  }

  function finalizeConfidence(conf: Confidence) {
    const pc = pendingConfRef.current;
    if (!exam || !pc) return;
    if (confTimerRef.current) { window.clearTimeout(confTimerRef.current); confTimerRef.current = null; }
    const idx = pc.questionIdx;
    const action = pc.nextAction;
    const updatedConf = [...confidences]; updatedConf[idx] = conf;
    setConfidences(updatedConf);
    setDraftConfidence(conf);
    setPendingConfidence(null);
    pendingConfRef.current = null;
    maybeAdapt();
    if (action === 'next') {
      goTo(idx + 1);
    } else {
      // Antes de submit, mostrar firma de entrega
      window.setTimeout(() => {
        setShowSignModal(true);
        // El submit real ocurre al confirmar firma
        (window as any).__pendingFinalConfidences = updatedConf;
      }, 50);
    }
  }

  function confirmSignAndSubmit() {
    const updatedConf = (window as any).__pendingFinalConfidences || confidences;
    setShowSignModal(false);
    setSignConfirmed(false);
    submitExam(undefined, updatedConf);
  }

  function toggleMark(idx: number) {
    setMarked(prev => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; });
  }

  // ─── SUBMIT ─────────────────────────────────────────────────
  async function submitExam(finalAnswers?: any[], finalConfidences?: (Confidence | null)[]) {
    if (!exam || evaluationBusyRef.current) return;
    const finals = finalAnswers || (() => { const a = [...answers]; a[currentQuestion] = draftAnswer; return a; })();
    const finalsConf = finalConfidences || confidences;
    const attempt = ++evaluationAttemptRef.current;
    evaluationControllerRef.current?.abort();
    const controller = new AbortController();
    evaluationControllerRef.current = controller;
    evaluationBusyRef.current = true;
    setAnswers(finals);
    setPendingSubmissionAnswers(finals);
    setPendingSubmissionConfidences(finalsConf);
    setSubmissionError('');
    setPaused(true);
    setPhase('evaluating');
    if (sessionId) {
      writeFreeToolState<PersistedExamState>(sessionId, effectiveSourceSelection.fingerprint, 'exam', {
        phase: 'evaluating', duration, recommendedMinutes, examMode, adaptive, exam,
        currentQuestion, answers: finals, confidences: finalsConf, draftAnswer,
        draftConfidence, marked: [...marked], deadlineAt, paused: true, remainingSeconds,
        questionTimes, evaluation: null, submissionError: '',
        pendingSubmissionAnswers: finals, pendingSubmissionConfidences: finalsConf, resultsTab,
      });
    }
    try {
      const res = await fetch('/api/alai-studyal-exam', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          mode: 'evaluate', exam, answers: finals, confidences: finalsConf,
          questionTimes,
          materia: materia?.nombre || '', tema: tema?.nombre || '', materialText,
        }),
      });
      const data = await res.json();
      if (controller.signal.aborted || attempt !== evaluationAttemptRef.current) return;
      if (!res.ok || !data.success) throw new Error(data.error);
      setEvaluation(data.evaluation);
      setPendingSubmissionAnswers(null);
      setPendingSubmissionConfidences(null);
      setSubmissionError('');

      // ── Mastery Engine: reportar resultado de Examen ──
      try {
        const ev = data.evaluation;
        if (ev) {
          const allConcepts = [
            ...(ev.masteredConcepts || []),
            ...(ev.weakConcepts || []),
          ].slice(0, 20);

          onMasteryEvent?.({
            tool: 'examen',
            materialId: materiales[0]?.materialId || materiales[0]?.id || '',
            score: ev.score ?? 0,
            confidence: Math.round((ev.passProbability ?? 0) * 100),
            conceptsIdentified: allConcepts,
            mistakeTypes: ev.weakConcepts?.slice(0, 5) || [],
            freeModeUse: true,
            freeDomainPct: 16,
          });
        }
      } catch (_) {}

      setPhase('results');
      window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 80);
    } catch (error: any) {
      if (controller.signal.aborted || attempt !== evaluationAttemptRef.current) return;
      setEvaluation(null);
      setSubmissionError(error?.message || 'No se pudo corregir el examen. Tu intento está guardado; vuelve a intentarlo.');
      setPhase('exam');
      setPaused(true);
    } finally {
      if (attempt === evaluationAttemptRef.current) {
        evaluationBusyRef.current = false;
        evaluationControllerRef.current = null;
      }
    }
  }

  function retryEvaluation() {
    if (!exam || evaluationBusyRef.current) return;
    void submitExam(
      pendingSubmissionAnswers || answers,
      pendingSubmissionConfidences || confidences,
    );
  }

  function togglePause() {
    if (paused) {
      setDeadlineAt(Date.now() + Math.max(0, remainingSeconds) * 1000);
      setPaused(false);
    } else {
      if (deadlineAt) setRemainingSeconds(Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000)));
      setPaused(true);
    }
  }

  function resetAll() {
    setPhase('setup'); setExam(null); setAnswers([]); setConfidences([]); setDraftAnswer('');
    setDraftConfidence(null); setCurrentQuestion(0); setEvaluation(null); setRemainingSeconds(duration * 60);
    setDeadlineAt(null); setSubmissionError(''); setPendingSubmissionAnswers(null); setPendingSubmissionConfidences(null);
    setGenError(''); setMarked(new Set()); setPaused(false); setResultsTab('overview');
    lastAdaptedAt.current = 0;
    try { localStorage.removeItem(storageKey); } catch {}
  }

  const canAdvance = isAnswered(draftAnswer);
  const canAdvanceRef = useRef(canAdvance);
  useEffect(() => { canAdvanceRef.current = canAdvance; }, [canAdvance]);

  // Ref a nextQuestion para que el listener siempre llame a la última versión
  const nextQuestionRef = useRef<() => void>(() => {});
  useEffect(() => { nextQuestionRef.current = nextQuestion; });
  const turningRef = useRef(turning);
  useEffect(() => { turningRef.current = turning; }, [turning]);

  // Estado del modal de confianza tras "Siguiente"
  const [pendingConfidence, setPendingConfidence] = useState<null | { questionIdx: number; nextAction: 'next' | 'submit' }>(null);
  const pendingConfRef = useRef<null | { questionIdx: number; nextAction: 'next' | 'submit' }>(null);
  useEffect(() => { pendingConfRef.current = pendingConfidence; }, [pendingConfidence]);
  const confTimerRef = useRef<number | null>(null);

  // ═══ RENDER ═══
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999999, background: '#0a0a0c', color: '#f8fafc', fontFamily: BODY, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, maxWidth: 1400, width: '100%', margin: '0 auto', padding: phase === 'exam' ? '16px 28px 0' : '24px 28px 60px', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: phase === 'exam' ? 'hidden' : 'auto' }}>

        {/* ═══ SETUP ═══ */}
        {phase === 'setup' && (<>
          <button onClick={onBack} style={btnSecondary}>← Volver</button>

          <section style={{ border: '1.5px solid rgba(245,200,66,.20)', background: 'linear-gradient(135deg, rgba(33,18,4,.55), rgba(9,9,12,.94))', borderRadius: 22, padding: '32px 36px', margin: '24px 0' }}>
            <div style={{ color: '#f5c842', letterSpacing: 1.6, fontWeight: 900, fontSize: 12 }}>EVALUACIÓN FINAL ADAPTATIVA</div>
            <h1 style={{ margin: '12px 0 8px', fontSize: 38, lineHeight: 1, fontWeight: 900 }}>🧠 Examen ALAI</h1>
            <p style={{ color: 'rgba(255,255,255,.68)', fontSize: 15, lineHeight: 1.65, maxWidth: 760, margin: 0 }}>
              Examen real que se <strong style={{ color: '#f5c842' }}>adapta a ti</strong>. Si vas bien sube de dificultad. Si fallas en una habilidad, refuerza ahí.
              Mide qué tan seguro estás de cada respuesta para detectar dónde crees que sabes pero no sabes.
            </p>
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 24, alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 18 }}>
              <section style={cardDark}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 22 }}>📋</span>
                  <h2 style={{ margin: 0, fontSize: 17, color: '#f5c842', letterSpacing: 1.5, fontWeight: 900 }}>QUÉ EVALÚA</h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  {(Object.keys(SKILL_LABEL) as Skill[]).map(s => (
                    <div key={s} style={{ border: '1px solid rgba(245,200,66,.14)', background: 'rgba(255,255,255,.02)', borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontSize: 18 }}>{SKILL_ICON[s]}</span>
                      <div style={{ fontWeight: 900, fontSize: 13, color: '#f5c842' }}>{SKILL_LABEL[s]}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section style={cardDark}>
                <div style={lblSection}>MODO DE EXAMEN</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {(['closed', 'open'] as const).map(m => (
                    <button key={m} onClick={() => setExamMode(m)} style={{
                      padding: '14px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                      border: examMode === m ? '2px solid #f5c842' : '1px solid rgba(255,255,255,.12)',
                      background: examMode === m ? 'rgba(245,200,66,.10)' : 'rgba(255,255,255,.03)',
                      color: examMode === m ? '#f5c842' : 'rgba(255,255,255,.75)',
                    }}>
                      <div style={{ fontWeight: 900, fontSize: 14 }}>{m === 'closed' ? '📝 Cerrado' : '📖 Abierto'}</div>
                      <div style={{ fontSize: 11, opacity: .7, marginTop: 2 }}>{m === 'closed' ? 'Sin consultar material' : 'Puedes revisar el material'}</div>
                    </button>
                  ))}
                </div>

                <div style={{ marginTop: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input type="checkbox" checked={adaptive} onChange={e => setAdaptive(e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
                    <div>
                      <div style={{ fontWeight: 900, fontSize: 13, color: '#f5c842' }}>🤖 Examen adaptativo</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>Sube/baja dificultad y refuerza skills débiles</div>
                    </div>
                  </label>
                </div>
              </section>
            </div>

            <div style={cardDark}>
              <div style={{ marginBottom: 18 }}>
                <div style={lblSection}>RECOMENDADO POR ALAI</div>
                <button onClick={() => recommendedMinutes && setDuration(recommendedMinutes)} disabled={!recommendedMinutes}
                  style={{ width: '100%', padding: '14px 18px', borderRadius: 12, border: duration === recommendedMinutes ? '2px solid #f5c842' : '1.5px solid rgba(245,200,66,.42)', background: duration === recommendedMinutes ? 'linear-gradient(135deg, rgba(245,200,66,.18), rgba(245,200,66,.06))' : 'rgba(245,200,66,.06)', color: '#f5c842', fontWeight: 900, fontSize: 15, cursor: recommendedMinutes ? 'pointer' : 'not-allowed', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>⚡</span>{recommendedMinutes ? `${recommendedMinutes} min · ideal` : 'Analizando...'}
                  </span>
                  {duration === recommendedMinutes && <span>✓</span>}
                </button>
              </div>

              <div style={lblSection}>DURACIÓN</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                {[5, 10, 20, 30, 45, 60].map(d => (
                  <button key={d} onClick={() => setDuration(d)} style={{ padding: '12px 6px', borderRadius: 10, cursor: 'pointer', border: duration === d ? '2px solid #f5c842' : '1px solid rgba(255,255,255,.12)', background: duration === d ? 'rgba(245,200,66,.10)' : 'rgba(255,255,255,.03)', color: duration === d ? '#f5c842' : 'rgba(255,255,255,.75)', fontWeight: 800, fontSize: 13 }}>{d} min</button>
                ))}
              </div>

              <div style={{ marginTop: 20 }}>
                <div style={lblSection}>MATERIAL</div>
                <div style={infoBox}>📄 {materialNames.join(', ') || 'Material seleccionado'}</div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={lblSection}>ALCANCE</div>
                <div style={infoBox}>{selectedPagesLabel}</div>
              </div>

              {genError && <div style={errBox}>{genError}</div>}

              <button onClick={generateExam} disabled={loadingText} style={{ marginTop: 22, width: '100%', padding: 16, borderRadius: 12, border: 'none', background: loadingText ? '#555' : 'linear-gradient(135deg, #f5c842, #d6a72c)', color: '#080808', fontWeight: 950, fontSize: 14, letterSpacing: 1, cursor: loadingText ? 'not-allowed' : 'pointer' }}>
                {loadingText ? 'CARGANDO MATERIAL...' : 'COMENZAR EXAMEN →'}
              </button>
            </div>
          </div>
        </>)}

        {/* ═══ GENERATING ═══ */}
        {phase === 'generating' && (
          <section style={{ minHeight: '85vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{ color: '#f5c842', letterSpacing: 4, fontWeight: 900, fontSize: 13, marginBottom: 14 }}>STUDYAL · EXAMEN ALAI</div>
              <h1 style={{ margin: 0, fontSize: 36, fontWeight: 900 }}>ALAI está construyendo tu examen</h1>
              <p style={{ color: 'rgba(255,255,255,.55)', fontSize: 15, lineHeight: 1.6, marginTop: 14, maxWidth: 580 }}>Extrayendo conceptos, calculando dificultad y generando preguntas adaptativas.</p>
            </div>
            <div style={{ position: 'relative', width: 200, height: 200, marginBottom: 40, display: 'grid', placeItems: 'center' }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid transparent', borderTopColor: '#f5c842', borderRightColor: 'rgba(245,200,66,.4)', animation: 'brainSpin 2.5s linear infinite', boxShadow: '0 0 40px rgba(245,200,66,.25)' }} />
              <div style={{ fontSize: 80, animation: 'brainPulse 2s ease-in-out infinite', filter: 'drop-shadow(0 0 18px rgba(245,200,66,.55))' }}>🧠</div>
            </div>
            <div style={{ width: '100%', maxWidth: 820, position: 'relative', marginBottom: 36 }}>
              <div style={{ position: 'absolute', left: '8%', right: '8%', top: 28, height: 2, background: 'rgba(245,200,66,.18)' }}>
                <div style={{ height: '100%', width: `${(genStep / (genSteps.length - 1)) * 100}%`, background: 'linear-gradient(90deg, #f5c842, #d6a72c)', transition: 'width .8s ease' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${genSteps.length}, 1fr)`, gap: 8, position: 'relative' }}>
                {genSteps.map((step, i) => {
                  const active = i === genStep, done = i < genStep;
                  return (<div key={i} style={{ textAlign: 'center' }}>
                    <div style={{ width: 56, height: 56, margin: '0 auto', borderRadius: '50%', background: active ? 'linear-gradient(135deg, #f5c842, #d6a72c)' : done ? 'rgba(245,200,66,.18)' : 'rgba(255,255,255,.05)', border: active ? '2px solid #f5c842' : done ? '2px solid rgba(245,200,66,.4)' : '2px solid rgba(255,255,255,.1)', display: 'grid', placeItems: 'center', fontSize: 22, color: active ? '#080808' : done ? '#f5c842' : 'rgba(255,255,255,.4)' }}>{step.icon}</div>
                    <div style={{ marginTop: 10, fontSize: 12, color: active ? '#f5c842' : done ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.4)', fontWeight: active ? 900 : 700 }}>{i + 1}. {step.label}</div>
                  </div>);
                })}
              </div>
            </div>
          </section>
        )}

        {/* ═══ EXAM ═══ */}
        {phase === 'exam' && exam && (() => {
          const q = questions[currentQuestion];
          const isLast = currentQuestion === questions.length - 1;
          const currentSourcePage = Number(q?.sourcePage) || undefined;
          return (<>
            <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
              <button onClick={onBack} style={btnSecondary}>← Salir</button>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ color: '#f5c842', fontWeight: 900, letterSpacing: 2, fontSize: 11 }}>STUDYAL · EXAMEN ALAI {adaptive && '· ADAPTATIVO'}</div>
                <div style={{ fontSize: 18, fontWeight: 900, marginTop: 2 }}>{exam.title}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowPdf(v => !v)} style={{ padding: '10px 14px', borderRadius: 10, background: showPdf ? 'rgba(245,200,66,.18)' : 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.10)', color: showPdf ? '#f5c842' : '#fff', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
                  📄 {showPdf ? 'Ocultar PDF' : 'Ver PDF'}
                </button>
                <button onClick={togglePause} style={{ padding: '10px 14px', borderRadius: 10, background: paused ? 'rgba(245,200,66,.18)' : 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.10)', color: paused ? '#f5c842' : '#fff', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
                  {paused ? '▶ Reanudar' : '⏸ Pausar'}
                </button>
              </div>
            </header>

            {paused && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(0,0,0,.88)', display: 'grid', placeItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 60 }}>⏸</div>
                  <h1 style={{ color: '#f5c842' }}>Examen pausado</h1>
                  {submissionError ? (
                    <>
                      <p style={{ color: '#fecaca', maxWidth: 520 }}>{submissionError}</p>
                      <button onClick={retryEvaluation} style={{ marginTop: 20, padding: '16px 32px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #f5c842, #d6a72c)', color: '#080808', fontWeight: 950, fontSize: 16, cursor: 'pointer' }}>Reintentar corrección</button>
                    </>
                  ) : (
                    <button onClick={togglePause} style={{ marginTop: 20, padding: '16px 32px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #f5c842, #d6a72c)', color: '#080808', fontWeight: 950, fontSize: 16, cursor: 'pointer' }}>Continuar →</button>
                  )}
                </div>
              </div>
            )}

            {pendingConfidence && (
              <ConfidenceModal
                onPick={finalizeConfidence}
                onDismiss={() => finalizeConfidence('low')}
                isSubmit={pendingConfidence.nextAction === 'submit'}
              />
            )}

            {showSignModal && (
              <SignModal
                userName={userName || 'Estudiante'}
                materia={materia?.nombre || ''}
                tema={tema?.nombre || ''}
                examCode={examCode}
                answeredCount={answeredCount}
                totalQuestions={questions.length}
                signConfirmed={signConfirmed}
                setSignConfirmed={setSignConfirmed}
                onConfirm={confirmSignAndSubmit}
                onCancel={() => { setShowSignModal(false); setSignConfirmed(false); }}
              />
            )}

            <div style={{ display: 'grid', gridTemplateColumns: examMode === 'open' && showPdf && pdfUrl ? 'minmax(0, 1fr) minmax(0, 1.1fr)' : '1fr', gap: 20, alignItems: 'stretch', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {examMode === 'open' && showPdf && pdfUrl && (
                <div style={{
                  height: '100%',
                  background: '#1a1a1f',
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,.08)',
                  display: 'flex', flexDirection: 'column',
                  minHeight: 0,
                }}>
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.06)', fontSize: 11, color: 'rgba(255,255,255,.6)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>📄</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {matActual?.nombre || matActual?.titulo || 'Material'}
                    </span>
                    {materiales.length > 1 && (
                      <span style={{ fontSize: 10, opacity: .6 }}>{activeMaterialIndex + 1}/{materiales.length}</span>
                    )}
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                    <PDFViewer
                      key={matActualId + '-' + pdfUrl}
                      url={pdfUrl}
                      selectedPages={activeMaterialSelectedPages}
                      themeColor="#f5c842"
                      onTotalPages={() => {}}
                      totalSelectedPages={activeMaterialSelectedPages.length}
                      activeMaterialIndex={activeMaterialIndex}
                      materialesCount={materiales.length}
                      forcedPage={currentSourcePage}
                      currentQuestionPage={currentSourcePage}
                      scrollTrigger={currentQuestion}
                    />
                  </div>
                </div>
              )}

              <div style={{ overflowY: 'auto', overflowX: 'hidden', height: '100%', paddingBottom: 60, paddingRight: 4 }}>
            {/* PAPER */}
            <div ref={paperRef} style={{
              maxWidth: 900, margin: '0 auto', background: '#ffffff', color: '#111',
              borderRadius: 6, padding: '48px 72px 60px', position: 'relative', fontFamily: SERIF,
              boxShadow: turning ? '0 80px 200px rgba(0,0,0,.7)' : '0 40px 120px rgba(0,0,0,.45)',
              transform: turning ? 'translateY(60px) scale(.94)' : 'translateY(0) scale(1)',
              opacity: turning ? 0.3 : 1,
              transition: 'transform .4s cubic-bezier(.4,0,.2,1), opacity .4s, box-shadow .4s',
            }}>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div style={{ fontSize: 13, letterSpacing: 6, fontWeight: 700, marginBottom: 12 }}>S T U D Y A L</div>
                <h1 style={{ margin: 0, fontSize: 24, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 500 }}>Examen generado por ALAI</h1>
                <div style={{ width: 240, height: 1, background: '#111', margin: '12px auto 0' }} />
              </div>

              {/* STATS BAR DENTRO DE LA HOJA */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10,
                marginBottom: 24,
                padding: '12px 14px',
                background: '#fafafa',
                border: '1px solid rgba(0,0,0,.12)',
                borderRadius: 6,
                fontFamily: BODY,
              }}>
                <PaperStat icon="⏱" label="TIEMPO" value={mins + ':' + secs} highlight={timePercent < 0.25} />
                <PaperStat label="PROGRESO" value={progress + '%'} />
                <PaperStat label="PREGUNTA" value={(currentQuestion + 1) + '/' + questions.length} />
                
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 56px', fontSize: 13, marginBottom: 26 }}>
                <FL label="MATERIA" value={materia?.nombre || ''} />
                <FL label="FECHA" value={today} />
                <FL label="TEMA" value={tema?.nombre || ''} />
                <FL label="DURACIÓN" value={`${duration} min`} />
                <FL label="NOMBRE" value={userName || ""} />
                <FL label="ALCANCE" value={selectedPagesLabel} />
              </div>

              <div style={{ textAlign: 'center', fontWeight: 700, letterSpacing: 2, marginBottom: 22, fontSize: 14 }}>{q.section}</div>

              <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', marginBottom: 6 }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{currentQuestion + 1}.</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5 }}>{q.prompt}</div>
                  <div style={{ marginTop: 5, fontSize: 10, color: '#888', fontFamily: BODY, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                    {TYPE_LABEL[q.type]} · {SKILL_LABEL[q.skill]} · {q.difficulty} · {q.points} pts
                  </div>
                </div>
                <button onClick={() => toggleMark(currentQuestion)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, padding: 4, opacity: marked.has(currentQuestion) ? 1 : .35 }} title="Marcar para revisar">
                  {marked.has(currentQuestion) ? '🚩' : '🏳️'}
                </button>
              </div>

              <div style={{ marginTop: 14 }}>
                <QRenderer q={q} value={draftAnswer} onChange={setDraftAnswer} onSubmit={nextQuestion} canSubmit={canAdvance} />
              </div>



              {/* IN-PAPER ACTIONS */}
              <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px dashed rgba(0,0,0,.18)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <button
                  onClick={() => {
                    setDraftAnswer(defaultAnswerFor(q.type));
                    setDraftConfidence('guess');
                    saveDraft(currentQuestion, defaultAnswerFor(q.type), 'guess');
                    if (!marked.has(currentQuestion)) toggleMark(currentQuestion);
                    if (!isLast) goTo(currentQuestion + 1);
                  }}
                  style={{ padding: '10px 16px', borderRadius: 8, border: '1.5px dashed rgba(0,0,0,.35)', background: 'transparent', color: '#555', cursor: 'pointer', fontFamily: BODY, fontWeight: 700, fontSize: 12, letterSpacing: .5 }}
                >
                  🤷 No sé / saltar
                </button>

                <button
                  onClick={nextQuestion}
                  disabled={!canAdvance || turning}
                  style={{
                    padding: '12px 22px', borderRadius: 8, border: 'none',
                    background: !canAdvance || turning ? '#bbb' : isLast ? '#991b1b' : '#111',
                    color: '#fff',
                    cursor: !canAdvance || turning ? 'not-allowed' : 'pointer',
                    fontFamily: BODY, fontWeight: 900, fontSize: 13, letterSpacing: .5, whiteSpace: 'nowrap',
                  }}
                  title={!isAnswered(draftAnswer) ? 'Responde primero' : ''}
                >
                  {isLast ? '🎓 Entregar examen' : 'Siguiente pregunta →'}
                </button>
              </div>

              <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,.08)', display: 'flex', justifyContent: 'space-between', fontSize: 10, letterSpacing: 1.5, fontWeight: 700, color: '#999' }}>
                <span>PÁGINA {currentQuestion + 1} DE {questions.length}</span>
                <span>{isLast ? 'ÚLTIMA' : 'CONTINÚA →'}</span>
              </div>
            </div>

            {/* MINIMAP */}
            <div style={{ maxWidth: 900, margin: '16px auto 0', display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'center', padding: '12px 16px', background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)' }}>
              {questions.map((_, i) => {
                const isCurrent = i === currentQuestion;
                const isMarked = marked.has(i);
                const done = isAnswered(answers[i]);
                const bg = isCurrent ? '#f5c842' : isMarked ? '#f59e0b' : done ? '#16a34a' : 'rgba(255,255,255,.12)';
                const color = isCurrent || isMarked || done ? '#000' : 'rgba(255,255,255,.5)';
                return (
                  <button key={i} onClick={() => goTo(i)} title={'Pregunta ' + (i + 1)} style={{ width: 28, height: 28, borderRadius: 6, border: isCurrent ? '2px solid #fff' : '1px solid rgba(255,255,255,.08)', background: bg, color, fontWeight: 800, fontSize: 10, cursor: 'pointer', display: 'grid', placeItems: 'center', position: 'relative', flexShrink: 0 }}>
                    {i + 1}
                    {isMarked && <span style={{ position: 'absolute', top: -5, right: -5, fontSize: 9 }}>🚩</span>}
                  </button>
                );
              })}
            </div>

            <div style={{ maxWidth: 900, margin: '14px auto 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button disabled={currentQuestion === 0} onClick={() => goTo(currentQuestion - 1)} style={{ padding: '12px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,.14)', background: currentQuestion === 0 ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.06)', color: currentQuestion === 0 ? 'rgba(255,255,255,.3)' : '#e5e7eb', cursor: currentQuestion === 0 ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 13 }}>← Anterior</button>
              <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 12 }}>{answeredCount}/{questions.length} respondidas</div>
            </div>
              </div>
            </div>
          </>);
        })()}

        {/* ═══ EVALUATING ═══ */}
        {phase === 'evaluating' && (
          <section style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 70, marginBottom: 14, animation: 'brainPulse 1.5s infinite' }}>📝</div>
              <h1 style={{ margin: 0, fontSize: 28 }}>ALAI está corrigiendo tu examen</h1>
              <p style={{ color: 'rgba(255,255,255,.6)', marginTop: 10 }}>Evaluando {questions.length} preguntas + calibración de confianza.</p>
            </div>
          </section>
        )}

        {/* ═══ RESULTS ═══ */}
        {phase === 'results' && exam && (
          <ResultsView
            exam={exam}
            evaluation={evaluation}
            answers={answers}
            confidences={confidences}
            questionTimes={questionTimes}
            resultsTab={resultsTab}
            setResultsTab={setResultsTab}
            onReset={resetAll}
            onBack={onBack}
          />
        )}
      </div>

      <style>{`
        @keyframes brainSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes brainPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        textarea::placeholder, input::placeholder { color: rgba(0,0,0,.32); }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// QUESTION RENDERER
// ═══════════════════════════════════════════════════════════════

function QRenderer({ q, value, onChange, onSubmit, canSubmit }: { q: ExamQuestion; value: any; onChange: (v: any) => void; onSubmit?: () => void; canSubmit?: boolean }) {
  if (q.type === 'multiple_choice') {
    return (<div style={{ display: 'grid', gap: 8 }}>
      {(q.options || []).map((opt, idx) => {
        const sel = value === idx;
        return (<button key={idx} onClick={() => onChange(idx)} style={{ textAlign: 'left', padding: '12px 16px', borderRadius: 6, border: sel ? '2px solid #111' : '1px solid rgba(0,0,0,.22)', background: sel ? '#fef9e7' : '#fff', cursor: 'pointer', fontFamily: SERIF, fontSize: 14, display: 'flex', gap: 12, alignItems: 'center', color: '#111' }}>
          <span style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid #111', display: 'grid', placeItems: 'center', fontWeight: 800, background: sel ? '#111' : 'transparent', color: sel ? '#fff' : '#111', flexShrink: 0, fontSize: 13 }}>{String.fromCharCode(65 + idx)}</span>
          <span>{opt}</span>
        </button>);
      })}
    </div>);
  }

  if (q.type === 'true_false') {
    return (<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {[{ v: true, l: 'Verdadero' }, { v: false, l: 'Falso' }].map(opt => {
        const sel = value === opt.v;
        return (<button key={String(opt.v)} onClick={() => onChange(opt.v)} style={{ padding: '16px 20px', borderRadius: 6, border: sel ? '2px solid #111' : '1px solid rgba(0,0,0,.22)', background: sel ? '#fef9e7' : '#fff', cursor: 'pointer', fontFamily: SERIF, fontSize: 16, fontWeight: 700, color: '#111' }}>{opt.l}</button>);
      })}
    </div>);
  }

  if (q.type === 'fill_blank') {
    return <FillBlankRenderer q={q} value={value} onChange={onChange} onSubmit={onSubmit} canSubmit={canSubmit} />;
  }

  if (q.type === 'matching') {
    return <MatchingRenderer q={q} value={value} onChange={onChange} />;
  }

  const minH = q.type === 'short_answer' ? 120 : 280;
  return (<textarea
    value={value || ''}
    onChange={e => onChange(e.target.value)}

    style={{
      width: '100%', minHeight: minH, border: 'none', background: 'transparent', padding: 0,
      fontFamily: SERIF, fontSize: 14, lineHeight: '34px', outline: 'none', resize: 'vertical', color: '#111',
      backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0px, transparent 33px, rgba(0,0,0,.45) 33px, rgba(0,0,0,.45) 34px)',
      backgroundSize: '100% 34px',
    }}
  />);
}

function FillBlankRenderer({ q, value, onChange, onSubmit, canSubmit }: { q: ExamQuestion; value: any; onChange: (v: any) => void; onSubmit?: () => void; canSubmit?: boolean }) {
  const [showBank, setShowBank] = useState(false);
  return (<div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
      <span style={{ fontFamily: SERIF, fontSize: 14, color: '#333' }}>Respuesta:</span>
      <input
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        /* Enter manejado por global listener */
        placeholder="escribe aquí..."
        style={{ flex: 1, padding: '8px 4px', border: 'none', borderBottom: '2px solid #111', outline: 'none', fontFamily: SERIF, fontSize: 16, background: 'transparent', color: '#111' }}
        autoFocus
      />
    </div>
    {q.wordBank?.length ? (
      <div style={{ marginTop: 16 }}>
        <button type="button" onClick={() => setShowBank(b => !b)} style={{
          padding: '8px 16px', borderRadius: 8, border: '1.5px dashed rgba(0,0,0,.35)',
          background: 'transparent', cursor: 'pointer', fontFamily: BODY, fontSize: 12, fontWeight: 800,
          color: '#666', letterSpacing: .8, textTransform: 'uppercase',
        }}>
          {showBank ? '🔒 Ocultar banco de palabras' : '💡 Ver banco de palabras (penaliza)'}
        </button>
        {showBank && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {q.wordBank.map((w, i) => (
              <button key={i} onClick={() => onChange(w)} style={{ padding: '8px 16px', borderRadius: 20, border: normalize(value || '') === normalize(w) ? '2px solid #111' : '1px solid rgba(0,0,0,.22)', background: normalize(value || '') === normalize(w) ? '#fef9e7' : '#fff', cursor: 'pointer', fontFamily: SERIF, fontSize: 14, color: '#111' }}>{w}</button>
            ))}
          </div>
        )}
      </div>
    ) : null}
  </div>);
}

// MATCHING ESTILO QUIZ con curvas pero SIN COLORES
function MatchingRenderer({ q, value, onChange }: { q: ExamQuestion; value: any; onChange: (v: any) => void }) {
  const pairs = q.pairs || [];
  const userMap: Record<number, number> = value && typeof value === 'object' ? value : {};
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);

  // Shuffle estable de los rights
  const rightItems = useMemo(() => {
    const base = pairs.map((p, i) => ({ text: p.right, originalIndex: i }));
    let h = 2166136261;
    const seed = pairs.map(p => p.left + ':' + p.right).join('|');
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    const arr = [...base];
    for (let i = arr.length - 1; i > 0; i--) {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      const j = Math.abs(h) % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (arr.every((it, idx) => it.originalIndex === idx) && arr.length > 1) {
      arr.push(arr.shift()!);
    }
    return arr;
  }, [pairs]);

  function connect(leftIdx: number, rightVisible: number) {
    const rightOrig = rightItems[rightVisible]?.originalIndex;
    if (rightOrig === undefined) return;
    const next: Record<number, number> = { ...userMap };
    for (const k of Object.keys(next)) {
      if (next[Number(k)] === rightOrig) delete next[Number(k)];
    }
    next[leftIdx] = rightOrig;
    onChange(next);
    setSelectedLeft(null);
  }

  function clearLeft(leftIdx: number) {
    const next = { ...userMap };
    delete next[leftIdx];
    onChange(next);
  }

  const rowH = 88;
  const height = Math.max(1, pairs.length) * rowH;
  const leftX = 252;
  const rightX = 468;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ textAlign: 'center', color: '#666', fontFamily: BODY, fontSize: 12, fontStyle: 'italic' }}>
        Clic en uno de la izquierda y luego en su pareja de la derecha.
      </div>

      <div style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 120px minmax(0, 1fr)',
        gap: 14,
        minHeight: height,
        overflow: 'visible',
      }}>
        {/* SVG con líneas curvas en B/N */}
        <svg
          viewBox={'0 0 720 ' + height}
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height, zIndex: 0, pointerEvents: 'none', overflow: 'visible' }}
        >
          {Object.entries(userMap).map(([leftStr, rightOrig], n) => {
            const leftIdx = Number(leftStr);
            const rightVis = rightItems.findIndex(r => r.originalIndex === rightOrig);
            if (rightVis < 0) return null;
            const y1 = leftIdx * rowH + rowH / 2;
            const y2 = rightVis * rowH + rowH / 2;
            const bend = 42 + Math.abs(leftIdx - rightVis) * 16;
            const wave = ((leftIdx + rightVis + n) % 2 === 0 ? 1 : -1) * 14;
            return (
              <path
                key={leftIdx + '-' + rightOrig}
                d={'M ' + leftX + ' ' + y1 + ' C ' + (leftX + bend) + ' ' + (y1 + wave) + ', ' + (rightX - bend) + ' ' + (y2 - wave) + ', ' + rightX + ' ' + y2}
                fill="none"
                stroke="#111"
                strokeWidth={2}
                strokeLinecap="round"
                opacity={0.75}
              />
            );
          })}
        </svg>

        {/* IZQUIERDA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, zIndex: 2 }}>
          {pairs.map((p, i) => {
            const connected = userMap[i] !== undefined;
            const isSel = selectedLeft === i;
            return (
              <button
                key={i}
                onClick={() => connected ? clearLeft(i) : setSelectedLeft(isSel ? null : i)}
                style={{
                  minHeight: 76, padding: '12px 14px',
                  borderRadius: 8,
                  border: isSel ? '2.5px solid #111' : connected ? '2px solid #111' : '1.5px solid rgba(0,0,0,.22)',
                  background: isSel ? '#f5f5f5' : connected ? '#fafafa' : '#fff',
                  color: '#111', fontWeight: 700, fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: SERIF, textAlign: 'left', width: '100%',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
                title={connected ? 'Clic para desconectar' : 'Clic para seleccionar'}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#111' : '#ccc', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{p.left}</span>
              </button>
            );
          })}
        </div>

        <div style={{ zIndex: 1 }} />

        {/* DERECHA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, zIndex: 2 }}>
          {rightItems.map((item, vIdx) => {
            const usedBy = Object.entries(userMap).find(([_, r]) => r === item.originalIndex);
            const isUsed = !!usedBy;
            const canClick = selectedLeft !== null;
            return (
              <button
                key={item.originalIndex}
                onClick={() => canClick && connect(selectedLeft!, vIdx)}
                style={{
                  minHeight: 76, padding: '12px 14px',
                  borderRadius: 8,
                  border: isUsed ? '2px solid #111' : '1.5px solid rgba(0,0,0,.22)',
                  background: isUsed ? '#fafafa' : canClick ? '#f9f9f9' : '#fff',
                  color: '#111', fontWeight: 700, fontSize: 13,
                  cursor: canClick ? 'crosshair' : 'default',
                  fontFamily: SERIF, textAlign: 'right', width: '100%',
                  display: 'flex', alignItems: 'center', gap: 8,
                  justifyContent: 'flex-end',
                }}
              >
                <span style={{ flex: 1, textAlign: 'right' }}>{item.text}</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: isUsed ? '#111' : '#ccc', flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SIGN MODAL — declaración de entrega
// ═══════════════════════════════════════════════════════════════

function SignModal({ userName, materia, tema, examCode, answeredCount, totalQuestions, signConfirmed, setSignConfirmed, onConfirm, onCancel }: any) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999998,
      background: 'rgba(10,10,12,.88)',
      backdropFilter: 'blur(6px)',
      display: 'grid', placeItems: 'center',
      animation: 'fadeIn .2s ease',
    }}>
      <div style={{
        background: '#fff', color: '#111',
        borderRadius: 6, padding: '40px 48px',
        maxWidth: 560, width: '92%',
        boxShadow: '0 60px 160px rgba(0,0,0,.7)',
        fontFamily: SERIF,
        border: '1px solid #111',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 12, letterSpacing: 6, fontWeight: 700, marginBottom: 10 }}>S T U D Y A L</div>
          <h2 style={{ margin: 0, fontSize: 22, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 500 }}>
            Declaración de entrega
          </h2>
          <div style={{ width: 200, height: 1, background: '#111', margin: '12px auto 0' }} />
        </div>

        <div style={{
          padding: '20px 22px',
          border: '1px solid rgba(0,0,0,.22)',
          borderRadius: 4,
          marginBottom: 24,
          fontSize: 14,
          lineHeight: 1.7,
        }}>
          Yo, <strong>{userName}</strong>, declaro que he revisado mis respuestas al examen
          {materia && <> de <strong>{materia}</strong></>}
          {tema && <> sobre <strong>{tema}</strong></>} y deseo entregarlo formalmente para evaluación.
          <div style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
            Respondidas: <strong>{answeredCount}/{totalQuestions}</strong>
            {answeredCount < totalQuestions && (
              <span style={{ color: '#991b1b', marginLeft: 8 }}>
                · {totalQuestions - answeredCount} sin responder (contarán 0 pts)
              </span>
            )}
          </div>
        </div>

        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '14px 16px', borderRadius: 4,
          border: signConfirmed ? '2px solid #111' : '1px solid rgba(0,0,0,.25)',
          background: signConfirmed ? '#fafafa' : '#fff',
          cursor: 'pointer', fontFamily: BODY, fontSize: 13,
          marginBottom: 22,
        }}>
          <input
            type="checkbox"
            checked={signConfirmed}
            onChange={e => setSignConfirmed(e.target.checked)}
            style={{ width: 18, height: 18, marginTop: 1, cursor: 'pointer', accentColor: '#111' }}
          />
          <span>
            Confirmo que esta es mi entrega final y acepto que ALAI evalúe mi desempeño según el material estudiado.
          </span>
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '14px 20px', borderRadius: 6,
              border: '1px solid rgba(0,0,0,.2)',
              background: '#fff', color: '#111',
              fontFamily: BODY, fontWeight: 700, fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Revisar más
          </button>
          <button
            onClick={onConfirm}
            disabled={!signConfirmed}
            style={{
              padding: '14px 20px', borderRadius: 6,
              border: 'none',
              background: signConfirmed ? '#111' : '#bbb',
              color: '#fff',
              fontFamily: BODY, fontWeight: 900, fontSize: 13,
              letterSpacing: .8,
              cursor: signConfirmed ? 'pointer' : 'not-allowed',
            }}
          >
            🎓 Entregar examen
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 10, color: '#999', letterSpacing: 1, fontFamily: BODY }}>
          Código: {examCode}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CONFIDENCE MODAL — aparece tras tocar Siguiente, 3s para elegir
// ═══════════════════════════════════════════════════════════════

function ConfidenceModal({ onPick, onDismiss, isSubmit }: { onPick: (c: Confidence) => void; onDismiss: () => void; isSubmit?: boolean }) {
  const [secondsLeft, setSecondsLeft] = useState(10);

  useEffect(() => {
    const t = window.setInterval(() => setSecondsLeft(s => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onDismiss(); return; }
      if (e.key === '1') { e.preventDefault(); onPick('guess'); return; }
      if (e.key === '2') { e.preventDefault(); onPick('low'); return; }
      if (e.key === '3') { e.preventDefault(); onPick('high'); return; }
      if (e.key === '4') { e.preventDefault(); onPick('very_high'); return; }
      if (e.key === 'Escape') { e.preventDefault(); onDismiss(); return; }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onPick, onDismiss]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999998,
        background: 'rgba(10,10,12,.78)',
        backdropFilter: 'blur(4px)',
        display: 'grid', placeItems: 'center',
        animation: 'fadeIn .2s ease',
      }}
    >
      <div style={{
        background: '#fff', color: '#111',
        borderRadius: 18, padding: '28px 32px',
        maxWidth: 520, width: '90%',
        boxShadow: '0 40px 120px rgba(0,0,0,.6)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 32, marginBottom: 4 }}>🎯</div>
        <h2 style={{ margin: '4px 0 6px', fontSize: 20, fontWeight: 900 }}>
          ¿Qué tan seguro estás?
        </h2>
        <div style={{ color: '#666', fontSize: 13, marginBottom: 18 }}>
          Esto nos ayuda a detectar dónde crees que sabes pero no sabes.
          <br />
          <span style={{ color: '#999', fontSize: 11 }}>
            Si no eliges en {secondsLeft}s, se marca como "Poco seguro" y {isSubmit ? 'se entrega el examen' : 'avanza'}.
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {(['guess', 'low', 'high', 'very_high'] as Confidence[]).map(c => (
            <button
              key={c}
              onClick={() => onPick(c)}
              style={{
                padding: '14px 8px', borderRadius: 10,
                border: '1.5px solid rgba(0,0,0,.18)',
                background: '#fff', color: '#222',
                cursor: 'pointer', fontFamily: BODY, fontWeight: 800, fontSize: 12,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                transition: 'all .15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#111'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.color = '#222'; }}
            >
              <span style={{ fontSize: 22 }}>{CONFIDENCE_ICON[c]}</span>
              <span>{CONFIDENCE_LABEL[c]}</span>
              <span style={{ fontSize: 10, opacity: .55, marginTop: 2 }}>tecla {(['guess','low','high','very_high'] as Confidence[]).indexOf(c) + 1}</span>
            </button>
          ))}
        </div>

        <button
          onClick={onDismiss}
          style={{
            marginTop: 14, padding: '8px 16px',
            background: 'transparent', border: 'none',
            color: '#888', fontSize: 12, cursor: 'pointer',
            fontFamily: BODY, textDecoration: 'underline',
          }}
        >
          Saltar ({isSubmit ? 'entregar' : 'avanzar'})
        </button>
      </div>
    </div>
  );
}

// Componente legacy mantenido para compatibilidad (no se usa)
function ConfidenceBox({ visible, value, onChange }: { visible: boolean; value: Confidence | null; onChange: (c: Confidence) => void }) {
  const [show, setShow] = useState(false);
  const [dimmed, setDimmed] = useState(false);
  const fadeTimer = useRef<number | null>(null);

  useEffect(() => {
    if (visible) {
      setShow(true);
      setDimmed(false);
      if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
      // Si no se elige confianza en 4s → desvanecer (sigue clickeable)
      fadeTimer.current = window.setTimeout(() => {
        if (value === null) setDimmed(true);
      }, 4000);
    } else {
      setShow(false);
      setDimmed(false);
      if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    }
    return () => { if (fadeTimer.current) window.clearTimeout(fadeTimer.current); };
  }, [visible, value]);

  function handlePick(c: Confidence) {
    setDimmed(false);
    if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    onChange(c);
  }

  if (!show) return null;

  return (
    <div
      onMouseEnter={() => setDimmed(false)}
      style={{
        marginTop: 28, padding: '14px 16px',
        background: '#fafafa', borderRadius: 6,
        border: '1px solid rgba(0,0,0,.12)',
        opacity: dimmed ? 0.35 : 1,
        transform: dimmed ? 'translateY(4px)' : 'translateY(0)',
        transition: 'opacity .6s ease, transform .6s ease',
        animation: 'fadeIn .3s ease',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, color: '#666', letterSpacing: 1.2, marginBottom: 10, fontFamily: BODY }}>
        🎯 ¿QUÉ TAN SEGURO ESTÁS?
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {(['guess', 'low', 'high', 'very_high'] as Confidence[]).map(c => {
          const sel = value === c;
          return (
            <button key={c} onClick={() => handlePick(c)} style={{
              padding: '10px 8px', borderRadius: 8,
              border: sel ? '2px solid #111' : '1px solid rgba(0,0,0,.18)',
              background: sel ? '#111' : '#fff', color: sel ? '#fff' : '#333',
              cursor: 'pointer', fontFamily: BODY, fontWeight: 700, fontSize: 11,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            }}>
              <span style={{ fontSize: 18 }}>{CONFIDENCE_ICON[c]}</span>
              {CONFIDENCE_LABEL[c]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════

function ResultsView({ exam, evaluation, answers, confidences, questionTimes, resultsTab, setResultsTab, onReset, onBack }: any) {
  const score = evaluation?.score ?? 0;
  const skills = evaluation?.skillScores || {};
  const perQ = evaluation?.perQuestion || [];
  const grades = evaluation?.gradeProbabilities;

  // Calibración: cruzar correctness x confidence
  const calibration = useMemo(() => {
    const buckets = {
      correctSure: 0, correctUnsure: 0,
      wrongSure: 0, wrongUnsure: 0,
      skipped: 0,
    };
    exam.questions.forEach((q: ExamQuestion, i: number) => {
      const pq = perQ.find((p: any) => p.index === i);
      const conf = confidences[i];
      const correct = pq?.correct ?? false;
      if (conf === null || conf === undefined) { buckets.skipped += 1; return; }
      const sure = conf === 'high' || conf === 'very_high';
      if (correct && sure) buckets.correctSure += 1;
      else if (correct && !sure) buckets.correctUnsure += 1;
      else if (!correct && sure) buckets.wrongSure += 1;
      else if (!correct && !sure) buckets.wrongUnsure += 1;
    });
    return buckets;
  }, [exam, perQ, confidences]);

  return (
    <section style={{ background: '#fffdf7', color: '#111', borderRadius: 18, padding: '36px 40px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 48 }}>🎓</div>
        <h1 style={{ fontFamily: SERIF, margin: '8px 0 4px' }}>Reporte académico</h1>
        <div style={{ color: '#666', fontSize: 14 }}>{exam.title} · {exam.questions.length} preguntas · {exam.totalPoints} pts</div>
      </div>

      {/* SCORE + GRADES */}
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 28, alignItems: 'center', marginBottom: 28, padding: 22, borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,.1)' }}>
        <div style={{ width: 160, height: 160, borderRadius: '50%', display: 'grid', placeItems: 'center', border: `10px solid ${score >= 70 ? 'rgba(22,163,74,.2)' : score >= 50 ? 'rgba(234,179,8,.2)' : 'rgba(220,38,38,.15)'}`, color: score >= 70 ? '#16a34a' : score >= 50 ? '#b45309' : '#991b1b', fontSize: 38, fontWeight: 950 }}>{score}%</div>
        <div style={{ display: 'grid', gap: 14 }}>
          {grades && (
            <div>
              <div style={{ fontSize: 12, color: '#666', letterSpacing: 1.3, fontWeight: 800, marginBottom: 8 }}>🔥 RIESGO DE EXAMEN REAL</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                <GradeBar label="A" value={grades.A} color="#16a34a" />
                <GradeBar label="B" value={grades.B} color="#22d3ee" />
                <GradeBar label="C" value={grades.C} color="#eab308" />
                <GradeBar label="F" value={grades.fail} color="#dc2626" />
              </div>
            </div>
          )}
          <div style={{ fontSize: 14, color: '#333', lineHeight: 1.55 }}>
            <strong>Recomendación:</strong> {evaluation?.recommendation || '—'}
          </div>
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {[
          { id: 'overview', l: '📊 Resumen' },
          { id: 'calibration', l: '🎯 Calibración' },
          { id: 'times', l: '⏱ Tiempos' },
          { id: 'questions', l: '📋 Por pregunta' },
        ].map(t => (
          <button key={t.id} onClick={() => setResultsTab(t.id)} style={{
            padding: '10px 20px', borderRadius: 10,
            border: resultsTab === t.id ? '2px solid #111' : '1px solid rgba(0,0,0,.15)',
            background: resultsTab === t.id ? '#111' : '#fff',
            color: resultsTab === t.id ? '#fff' : '#111',
            fontWeight: 800, cursor: 'pointer', fontSize: 13,
          }}>{t.l}</button>
        ))}
      </div>

      {resultsTab === 'overview' && (<>
        <h2 style={{ fontFamily: SERIF, marginTop: 0, fontSize: 18 }}>Desempeño por habilidad</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 24 }}>
          {(Object.keys(SKILL_LABEL) as Skill[]).map(s => {
            const sc = skills[s] ?? 0;
            return (<div key={s} style={{ padding: 14, borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,.1)' }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>{SKILL_ICON[s]} {SKILL_LABEL[s]}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 8, background: '#eee', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${sc}%`, height: '100%', background: sc >= 70 ? '#16a34a' : sc >= 50 ? '#eab308' : '#dc2626' }} />
                </div>
                <strong style={{ fontSize: 14, color: '#991b1b' }}>{sc}%</strong>
              </div>
            </div>);
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 22 }}>
          <RBlock title="✅ Fortalezas" items={evaluation?.strengths || []} color="#16a34a" />
          <RBlock title="❌ A reforzar" items={evaluation?.weaknesses || []} color="#dc2626" />
          <RBlock title="🏆 Conceptos dominados" items={evaluation?.masteredConcepts || []} color="#16a34a" />
          <RBlock title="📌 Conceptos débiles" items={evaluation?.weakConcepts || []} color="#dc2626" />
        </div>

        {evaluation?.weakPages?.length ? (
          <div style={{ marginBottom: 22, padding: 14, borderRadius: 12, background: 'rgba(220,38,38,.06)', border: '1px solid rgba(220,38,38,.16)' }}>
            <strong style={{ color: '#991b1b' }}>Páginas débiles:</strong> {evaluation.weakPages.join(', ')}
          </div>
        ) : null}

        {evaluation?.recoveryPlan?.length ? (<>
          <h2 style={{ fontFamily: SERIF, fontSize: 18 }}>Plan de recuperación</h2>
          <div style={{ display: 'grid', gap: 10, marginBottom: 24 }}>
            {evaluation.recoveryPlan.map((step: any, i: number) => (
              <div key={i} style={{ padding: 14, borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,.1)', display: 'grid', gridTemplateColumns: '36px 1fr', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #f5c842, #d6a72c)', color: '#111', fontWeight: 950, display: 'grid', placeItems: 'center' }}>{i + 1}</div>
                <div><strong>{step.title}</strong><div style={{ color: '#555', fontSize: 14, marginTop: 2 }}>{step.detail}</div></div>
              </div>
            ))}
          </div>
        </>) : null}
      </>)}

      {resultsTab === 'calibration' && (
        <div>
          <h2 style={{ fontFamily: SERIF, marginTop: 0, fontSize: 18 }}>Calibración: ¿qué tan bien te conoces?</h2>
          <p style={{ color: '#555', fontSize: 14, lineHeight: 1.6 }}>
            Cruzamos tus respuestas con tu nivel de confianza. La zona roja es la más peligrosa: <strong>fallaste sintiéndote seguro</strong> — ahí crees que sabes pero no.
          </p>

          {/* MATRIZ 2x2 VISUAL */}
          <div style={{ marginTop: 22, padding: 24, background: '#fff', borderRadius: 14, border: '1px solid rgba(0,0,0,.1)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr', gridTemplateRows: '40px 1fr 1fr', gap: 8 }}>
              <div></div>
              <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 11, letterSpacing: 1, color: '#666', textTransform: 'uppercase' }}>Poco seguro</div>
              <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 11, letterSpacing: 1, color: '#666', textTransform: 'uppercase' }}>Muy seguro</div>

              <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', textAlign: 'center', fontWeight: 800, fontSize: 11, letterSpacing: 1, color: '#16a34a', textTransform: 'uppercase' }}>Correctas</div>
              <CalCell value={calibration.correctUnsure} color="#eab308" label="Suerte / intuición" subtitle="Acertaste pero no estabas seguro" />
              <CalCell value={calibration.correctSure} color="#16a34a" label="Dominio real" subtitle="Sabes y sabes que sabes" />

              <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', textAlign: 'center', fontWeight: 800, fontSize: 11, letterSpacing: 1, color: '#dc2626', textTransform: 'uppercase' }}>Incorrectas</div>
              <CalCell value={calibration.wrongUnsure} color="#6b7280" label="Sabías que no sabías" subtitle="Honesto. Estudia con calma." />
              <CalCell value={calibration.wrongSure} color="#dc2626" label="ZONA CRÍTICA" subtitle="Creías saber pero no. Máxima prioridad." highlight />
            </div>
          </div>

          {calibration.skipped > 0 && (
            <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: '#f5f5f5', fontSize: 13, color: '#666' }}>
              <strong>{calibration.skipped}</strong> preguntas saltadas / sin confianza marcada.
            </div>
          )}
        </div>
      )}

      {resultsTab === 'times' && (
        <TimesTab exam={exam} questionTimes={questionTimes || []} perQ={perQ} />
      )}

      {resultsTab === 'questions' && (
        <div style={{ display: 'grid', gap: 14 }}>
          {exam.questions.map((q: ExamQuestion, i: number) => {
            const pq = perQ.find((p: any) => p.index === i);
            const userAns = answers[i];
            const isCorrect = pq?.correct ?? false;
            const partialScore = pq?.partialScore ?? 0;
            const conf = confidences[i];

            return (
              <div key={q.id} style={{ padding: 18, borderRadius: 14, background: '#fff', border: `1.5px solid ${isCorrect ? 'rgba(22,163,74,.3)' : 'rgba(220,38,38,.3)'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: isCorrect ? '#16a34a' : partialScore >= 50 ? '#eab308' : '#dc2626', color: '#fff', fontWeight: 900, fontSize: 12, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{i + 1}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45 }}>{q.prompt}</div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>
                        {TYPE_LABEL[q.type]} · {q.points} pts · {SKILL_LABEL[q.skill]}
                        {conf && <> · {CONFIDENCE_ICON[conf as Confidence]} {CONFIDENCE_LABEL[conf as Confidence]}</>}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontWeight: 900, fontSize: 16, color: isCorrect ? '#16a34a' : partialScore >= 50 ? '#b45309' : '#dc2626', flexShrink: 0 }}>{partialScore}%</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                  <div style={{ padding: 10, borderRadius: 8, background: isCorrect ? 'rgba(22,163,74,.06)' : 'rgba(220,38,38,.06)', border: `1px solid ${isCorrect ? 'rgba(22,163,74,.15)' : 'rgba(220,38,38,.15)'}` }}>
                    <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: 1, marginBottom: 4, color: '#666' }}>TU RESPUESTA</div>
                    <div style={{ color: '#333' }}>{formatAnswer(q, userAns)}</div>
                  </div>
                  <div style={{ padding: 10, borderRadius: 8, background: 'rgba(22,163,74,.06)', border: '1px solid rgba(22,163,74,.15)' }}>
                    <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: 1, marginBottom: 4, color: '#666' }}>RESPUESTA CORRECTA</div>
                    <div style={{ color: '#16a34a' }}>{pq?.modelAnswer || formatCorrectAnswer(q)}</div>
                  </div>
                </div>

                {pq?.feedback && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(0,0,0,.03)', fontSize: 13, lineHeight: 1.5, color: '#555' }}>
                    <strong>Feedback:</strong> {pq.feedback}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 28 }}>
        <button onClick={onReset} style={{ padding: 16, borderRadius: 12, border: '1px solid rgba(0,0,0,.14)', background: '#fff', color: '#111', fontWeight: 900, cursor: 'pointer' }}>Repetir examen</button>
        <button onClick={onBack} style={{ padding: 16, borderRadius: 12, border: 'none', background: '#111', color: '#fff', fontWeight: 900, cursor: 'pointer' }}>Volver al StudyAL Process</button>
      </div>
    </section>
  );
}

function TimesTab({ exam, questionTimes, perQ }: { exam: GeneratedExam; questionTimes: number[]; perQ: any[] }) {
  const fmt = (ms: number) => {
    if (!ms || ms < 1000) return '< 1s';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + 'm ' + (r ? r + 's' : '');
  };

  const totalMs = questionTimes.reduce((a, b) => a + (b || 0), 0);
  const avgMs = questionTimes.length ? totalMs / questionTimes.length : 0;

  // Detección de patrones
  const fastWrong: number[] = [];
  const slowCorrect: number[] = [];
  exam.questions.forEach((q, i) => {
    const t = questionTimes[i] || 0;
    const pq = perQ.find((p: any) => p.index === i);
    if (!pq) return;
    if (!pq.correct && t < avgMs * 0.4 && t > 1000) fastWrong.push(i + 1);
    if (pq.correct && t > avgMs * 2) slowCorrect.push(i + 1);
  });

  const skillTimes: Record<string, { total: number; count: number }> = {};
  exam.questions.forEach((q, i) => {
    if (!skillTimes[q.skill]) skillTimes[q.skill] = { total: 0, count: 0 };
    skillTimes[q.skill].total += questionTimes[i] || 0;
    skillTimes[q.skill].count += 1;
  });

  const max = Math.max(...questionTimes, 1);

  return (
    <div>
      <h2 style={{ fontFamily: SERIF, marginTop: 0, fontSize: 18 }}>Tiempo por pregunta</h2>
      <p style={{ color: '#555', fontSize: 14, lineHeight: 1.6 }}>
        Análisis de cuánto tardaste en cada pregunta. Tiempo total: <strong>{fmt(totalMs)}</strong> · Promedio: <strong>{fmt(avgMs)}</strong>
      </p>

      {(fastWrong.length > 0 || slowCorrect.length > 0) && (
        <div style={{ marginTop: 12, marginBottom: 20, padding: 14, borderRadius: 12, background: 'rgba(245,200,66,.08)', border: '1px solid rgba(245,200,66,.32)' }}>
          <strong style={{ color: '#b45309', fontSize: 13 }}>📊 Patrones detectados por ALAI:</strong>
          <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 18, fontSize: 13, color: '#555', lineHeight: 1.7 }}>
            {fastWrong.length > 0 && (
              <li>Respondiste demasiado <strong>rápido</strong> e incorrectamente en las preguntas: {fastWrong.join(', ')}</li>
            )}
            {slowCorrect.length > 0 && (
              <li>Te tomó <strong>mucho tiempo</strong> acertar las preguntas: {slowCorrect.join(', ')} (concepto poco automatizado)</li>
            )}
          </ul>
        </div>
      )}

      <div style={{ display: 'grid', gap: 6, marginTop: 14 }}>
        {exam.questions.map((q, i) => {
          const t = questionTimes[i] || 0;
          const pq = perQ.find((p: any) => p.index === i);
          const correct = pq?.correct;
          const pct = (t / max) * 100;
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '32px 1fr 80px 22px', gap: 10, alignItems: 'center' }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: correct ? '#16a34a' : '#dc2626', color: '#fff', fontWeight: 900, fontSize: 11, display: 'grid', placeItems: 'center' }}>{i + 1}</div>
              <div style={{ position: 'relative', height: 22, background: '#f0f0f0', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ width: pct + '%', height: '100%', background: correct ? 'linear-gradient(90deg, #16a34a, #15803d)' : 'linear-gradient(90deg, #dc2626, #991b1b)', opacity: .8 }} />
                <div style={{ position: 'absolute', left: 8, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 11, color: '#fff', fontWeight: 700, mixBlendMode: 'difference' }}>
                  {TYPE_LABEL[q.type as QuestionType]}
                </div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#111', textAlign: 'right' }}>{fmt(t)}</div>
              <div style={{ fontSize: 14 }}>{correct ? '✓' : '✗'}</div>
            </div>
          );
        })}
      </div>

      <h3 style={{ fontFamily: SERIF, marginTop: 28, fontSize: 16 }}>Tiempo por habilidad</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
        {Object.entries(skillTimes).map(([sk, data]) => (
          <div key={sk} style={{ padding: 12, borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,.1)' }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{SKILL_ICON[sk as Skill]} {SKILL_LABEL[sk as Skill]}</div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>{fmt(data.total / data.count)} <span style={{ fontSize: 10, color: '#999', fontWeight: 500 }}>promedio</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GradeBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 8, borderRadius: 8, background: '#fafafa', border: '1px solid rgba(0,0,0,.08)', textAlign: 'center' }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 950, color }}>{value}%</div>
    </div>
  );
}

function CalCell({ value, color, label, subtitle, highlight }: { value: number; color: string; label: string; subtitle: string; highlight?: boolean }) {
  return (
    <div style={{
      padding: 16, borderRadius: 12,
      background: highlight ? color + '14' : color + '08',
      border: highlight ? '2.5px solid ' + color : '1px solid ' + color + '44',
      boxShadow: highlight ? '0 0 24px ' + color + '33' : 'none',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      minHeight: 110,
    }}>
      <div style={{ fontSize: 32, fontWeight: 950, color: '#111', lineHeight: 1 }}>{value}</div>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 900, color, fontSize: 12, letterSpacing: .3 }}>{label}</div>
        <div style={{ marginTop: 4, fontSize: 11, color: '#555', lineHeight: 1.4 }}>{subtitle}</div>
      </div>
    </div>
  );
}

function CalBox({ label, value, color, desc, highlight }: { label: string; value: number; color: string; desc: string; highlight?: boolean }) {
  return (
    <div style={{
      padding: 18, borderRadius: 14, background: '#fff',
      border: highlight ? `2.5px solid ${color}` : `1px solid rgba(0,0,0,.1)`,
      boxShadow: highlight ? `0 0 20px ${color}33` : 'none',
    }}>
      <div style={{ fontWeight: 900, color, fontSize: 14, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 36, fontWeight: 950, color: '#111', lineHeight: 1 }}>{value}</div>
      <div style={{ marginTop: 8, fontSize: 12, color: '#555', lineHeight: 1.45 }}>{desc}</div>
    </div>
  );
}

// ═══ HELPERS UI ═══

const btnSecondary: any = {
  background: 'transparent', color: '#f5c842',
  border: '1.5px solid rgba(245,200,66,.42)',
  padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
  fontWeight: 700, fontSize: 14,
};

const cardDark: any = {
  background: 'linear-gradient(180deg, rgba(20,18,14,.95), rgba(12,11,9,.95))',
  border: '1.5px solid rgba(245,200,66,.22)',
  borderRadius: 18, padding: 24,
};

const lblSection: any = { fontWeight: 900, letterSpacing: 1.3, fontSize: 11, color: 'rgba(255,255,255,.55)', marginBottom: 10 };
const infoBox: any = { padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 };
const errBox: any = { marginTop: 18, padding: 12, borderRadius: 10, background: 'rgba(220,38,38,.10)', border: '1px solid rgba(220,38,38,.32)', color: '#fca5a5', fontWeight: 700, fontSize: 13 };

function formatAnswer(q: ExamQuestion, ans: any): string {
  if (ans === null || ans === undefined) return '(sin responder)';
  if (q.type === 'multiple_choice') return q.options?.[ans] ?? String(ans);
  if (q.type === 'true_false') return ans === true ? 'Verdadero' : ans === false ? 'Falso' : String(ans);
  if (q.type === 'matching') {
    const pairs = q.pairs || [];
    const map = typeof ans === 'object' ? ans : {};
    return pairs.map((p, i) => `${p.left} → ${pairs[map[i]]?.right || '?'}`).join(' | ');
  }
  return String(ans);
}

function formatCorrectAnswer(q: ExamQuestion): string {
  if (q.type === 'multiple_choice') return q.options?.[q.correctAnswer] ?? '';
  if (q.type === 'true_false') return q.correctAnswer === true ? 'Verdadero' : 'Falso';
  if (q.type === 'matching') return (q.pairs || []).map(p => `${p.left} → ${p.right}`).join(' | ');
  return q.expectedAnswer || '';
}

function PaperStat({ icon, label, value, highlight, mono }: { icon?: string; label: string; value: string; highlight?: boolean; mono?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontSize: 16, fontWeight: 900,
        color: highlight ? '#dc2626' : '#111',
        fontFamily: mono ? "'Courier New', monospace" : BODY,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        animation: highlight ? 'brainPulse 1s infinite' : 'none',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
        {value}
      </div>
      <div style={{ fontSize: 9, color: '#666', letterSpacing: 1, marginTop: 2, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

function FL({ label, value }: { label: string; value: string }) {
  return (<div style={{ display: 'grid', gridTemplateColumns: '85px 1fr', alignItems: 'baseline', gap: 10 }}>
    <strong style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: .6, whiteSpace: 'nowrap', textAlign: 'left' }}>{label}:</strong>
    <span style={{ borderBottom: '1px solid #111', paddingBottom: 3, minHeight: 18, fontSize: 13, paddingLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
  </div>);
}

function TopStat({ label, value }: { label: string; value: string }) {
  return (<div style={{ minWidth: 80, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.10)' }}>
    <div style={{ color: '#f5c842', fontWeight: 900, fontSize: 15 }}>{value}</div>
    <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 9, textTransform: 'uppercase', letterSpacing: .8, marginTop: 1 }}>{label}</div>
  </div>);
}

function RBlock({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (<div style={{ padding: 14, borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,.1)' }}>
    <div style={{ fontWeight: 900, color, marginBottom: 8, fontSize: 13 }}>{title}</div>
    {!items.length ? <div style={{ color: '#888', fontSize: 13 }}>—</div> : (
      <ul style={{ margin: 0, paddingLeft: 18, color: '#333', fontSize: 13, lineHeight: 1.6 }}>
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    )}
  </div>);
}
