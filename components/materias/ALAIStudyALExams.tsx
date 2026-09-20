'use client';

import { AcademicContent } from '../academic/AcademicContent';
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useMasteryReporter } from '../../hooks/useMastery';
import dynamic from 'next/dynamic';
import { buildSourceSelectionFromMaterials, type SourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';
import { sourceScopedKey } from '../../lib/materials/authorizedSource';
import { getSessionById, updateSessionById } from '../../lib/studySessions';
import { readFreeToolState, writeFreeToolState, clearFreeToolState } from '../../lib/freeToolState';
import { FillBlankPresentation, type FillBlankOption } from '../quiz/FillBlankPresentation';
import MatchingInteractionCore from '../quiz/MatchingInteractionCore';

const PDFViewer = dynamic(() => import('./FlashcardsPDFViewer'), { ssr: false });

const BODY = "var(--font-body)";
const SERIF = "'Times New Roman', Georgia, serif";

type QuestionType = 'short_answer' | 'open_response' | 'multiple_choice' | 'true_false' | 'matching' | 'fill_blank' | 'case_application' | 'multi_select';
type Skill = 'retention' | 'comprehension' | 'application' | 'relation' | 'explanation' | 'critical_thinking';
type Difficulty = 'basic' | 'medium' | 'advanced';
type Confidence = 'guess' | 'low' | 'high' | 'very_high';

interface ExamQuestion {
  id: string; slotId?: string; section: string; type: QuestionType; prompt: string; points: number;
  options?: string[]; correctAnswer?: any; correctAnswers?: number[]; expectedAnswer?: string; rubricHints?: string[];
  sourceMaterial?: string; sourceMaterialName?: string; sourcePage?: number; sourcePages?: number[];
  skill: Skill; difficulty: Difficulty; pairs?: { left: string; right: string }[];
  matchingLeftTexts?: string[]; matchingRightTexts?: string[]; matchingCorrectMap?: Record<number, number>;
  wordBank?: string[];
  grounding?: {
    authorityType: 'studyal_material_enjoyer'; authorityVersion: string;
    sourceSelectionFingerprint: string; targetIds: string[]; sourceItemIds: string[];
    evidence: Array<{ materialId: string; page: number; quote: string }>;
  };
  /** Progressive generation: false while this frozen slot's wording is still being generated. */
  ready?: boolean;
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
  skillScores: Record<Skill, number | null>;
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
  requestedDurationMinutes?: number;
  recommendedMinutes: number | null;
  examId: string | null;
  attemptId?: string | null;
  authorityType?: 'studyal_material_enjoyer' | 'material_brain_legacy';
  authorityVersion?: string | null;
  generatorVersion?: string | null;
  totalSlots: number;
  readyCount: number;
  genStatus: 'generating' | 'ready' | 'failed';
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
  resultsTab: ExamResultTab;
}

export function isExamFullyReady(
  exam: GeneratedExam | null, status: string, readyCount: number, totalSlots: number,
): boolean {
  return status === 'ready' && totalSlots > 0 && readyCount === totalSlots
    && Boolean(exam && exam.questions.length === totalSlots
      && exam.questions.every(question => question.ready !== false));
}

export type ExamResultTab = 'questions' | 'calibration' | 'times' | 'overview';

/**
 * Deterministic A/B/C/D/F grading scale reusing StudyAL's canonical mapping:
 * >= 90: A, >= 80: B, >= 70: C, >= 60: D, < 60: F.
 */
export function computeExamLetterGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  if (clamped >= 90) return 'A';
  if (clamped >= 80) return 'B';
  if (clamped >= 70) return 'C';
  if (clamped >= 60) return 'D';
  return 'F';
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

type Phase = 'setup' | 'generating' | 'preview' | 'exam' | 'evaluating' | 'results';

export function examGradingFailureMessage(payload: any): string {
  if (payload?.retryable || payload?.partialEvaluation?.gradingStatus === 'grading_incomplete') {
    return 'No pudimos completar la corrección automática en este momento. Tus respuestas están guardadas; puedes reintentar la corrección sin regenerar el examen.';
  }
  if (String(payload?.error || '').includes('PERSISTENCE') || String(payload?.error || '').includes('RESTORE')) {
    return 'No pudimos guardar o recuperar la corrección. Tus respuestas siguen guardadas en este intento; vuelve a intentarlo.';
  }
  return 'No se pudo corregir el examen. Tu intento está guardado; vuelve a intentarlo.';
}

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
  multi_select: 'Selección múltiple',
};
const CONFIDENCE_LABEL: Record<Confidence, string> = {
  guess: 'Adiviné', low: 'Poco seguro', high: 'Seguro', very_high: 'Muy seguro',
};
const CONFIDENCE_ICON: Record<Confidence, string> = {
  guess: '🎲', low: '🤔', high: '👍', very_high: '💪',
};

export const EXAM_ADVANCE_BACKOFF_DELAYS = [2000, 4000, 8000, 16000, 30000] as const;
export const EXAM_ADVANCE_MAX_FAILURES = 5;

export function getAdvanceBackoffDelay(consecutiveFailures: number): number | null {
  if (consecutiveFailures <= 0) return null;
  if (consecutiveFailures > EXAM_ADVANCE_BACKOFF_DELAYS.length) return null;
  return EXAM_ADVANCE_BACKOFF_DELAYS[consecutiveFailures - 1];
}

function defaultAnswerFor(type: QuestionType): any {
  if (type === 'multiple_choice' || type === 'true_false') return null;
  if (type === 'matching') return {};
  if (type === 'multi_select') return [];
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
    if (q.matchingCorrectMap && typeof q.matchingCorrectMap === 'object') {
      const keys = Object.keys(q.matchingCorrectMap);
      const map = typeof ans === 'object' && ans !== null ? ans : {};
      return keys.length > 0 && keys.every(k => Number(map[k]) === Number((q.matchingCorrectMap as any)[k]));
    }
    const pairs = q.pairs || [];
    const map = typeof ans === 'object' && ans !== null ? ans : {};
    return pairs.length > 0 && pairs.every((_, i) => map[i] === i);
  }
  return null;
}

export function PaperStat({ icon, label, value, highlight, mono }: { icon?: string; label: string; value: string; highlight?: boolean; mono?: boolean }) {
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

export function FL({ label, value }: { label: string; value: string }) {
  return (<div style={{ display: 'grid', gridTemplateColumns: '85px 1fr', alignItems: 'baseline', gap: 10 }}>
    <strong style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: .6, whiteSpace: 'nowrap', textAlign: 'left' }}>{label}:</strong>
    <span style={{ borderBottom: '1px solid #111', paddingBottom: 3, minHeight: 18, fontSize: 13, paddingLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
  </div>);
}

export function ExamPaperHeader({
  materia,
  tema,
  userName,
  duration,
  today,
  selectedPagesLabel,
  grade,
  stats,
}: {
  materia?: any;
  tema?: any;
  userName?: string;
  duration?: number;
  today?: string;
  selectedPagesLabel?: string;
  grade?: { letter: string; score: number; color?: string };
  stats?: Array<{ icon?: string; label: string; value: string; highlight?: boolean }>;
}) {
  return (
    <>
      <div style={{ position: 'relative', marginBottom: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, letterSpacing: 6, fontWeight: 700, marginBottom: 12 }}>S T U D Y A L</div>
          <h1 style={{ margin: 0, fontSize: 24, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 500 }}>
            {grade ? 'Examen corregido por ALAI' : 'Examen generado por ALAI'}
          </h1>
          <div style={{ width: 240, height: 1, background: '#111', margin: '12px auto 0' }} />
        </div>

        {grade && (
          <div
            data-testid="exam-header-grade"
            style={{
              position: 'absolute',
              top: -6,
              right: 0,
              textAlign: 'center',
              lineHeight: 1,
              userSelect: 'none',
              fontFamily: SERIF,
            }}
          >
            <div style={{
              fontSize: 56,
              fontWeight: 950,
              color: grade.color || '#16a34a',
              lineHeight: 1,
            }}>
              {grade.letter}
            </div>
            <div style={{
              fontSize: 16,
              fontWeight: 800,
              color: grade.color || '#16a34a',
              marginTop: 2,
              fontFamily: BODY,
              letterSpacing: -0.3,
            }}>
              {grade.score}%
            </div>
          </div>
        )}
      </div>

      {stats && stats.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(' + stats.length + ', 1fr)',
          gap: 10,
          marginBottom: 24,
          padding: '12px 14px',
          background: '#fafafa',
          border: '1px solid rgba(0,0,0,.12)',
          borderRadius: 6,
          fontFamily: BODY,
        }}>
          {stats.map((st, i) => (
            <PaperStat key={i} icon={st.icon} label={st.label} value={st.value} highlight={st.highlight} />
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 56px', fontSize: 13, marginBottom: 26 }}>
        <FL label="MATERIA" value={materia?.nombre || materia?.name || ''} />
        <FL label="FECHA" value={today || ''} />
        <FL label="TEMA" value={tema?.nombre || tema?.name || ''} />
        <FL label="DURACIÓN" value={duration ? duration + ' min' : ''} />
        <FL label="NOMBRE" value={userName || ''} />
        <FL label="ALCANCE" value={selectedPagesLabel || ''} />
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
export default function ALAIStudyALExams({ materiales, seleccion, tema, materia, onBack, userName, onMasteryEvent, masteryContext, sessionId, sourceSelection }: Props) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [duration, setDuration] = useState(30);
  const [requestedDurationMinutes, setRequestedDurationMinutes] = useState(30);
  const [recommendedMinutes, setRecommendedMinutes] = useState<number | null>(null);
  const [idealDurationMinutes, setIdealDurationMinutes] = useState<number | null>(null);
  const [minimumViableMinutes, setMinimumViableMinutes] = useState<number | null>(null);
  const [examMode, setExamMode] = useState<'closed' | 'open'>('closed');
  const [adaptive, setAdaptive] = useState(true);

  // Active Exam authority is server-side persisted Material Enjoyer. Raw
  // extracted material is never loaded or sent for generation/grading.
  const materialText = '';
  const loadingText = false;
  const [genError, setGenError] = useState('');
  // Preparación localizada (ver lib/materialBrain/toolPreparation.ts).
  const [preparingMessage, setPreparingMessage] = useState<string | null>(null);
  const preparationAttemptRef = useRef(0);
  const preparationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (preparationTimerRef.current) clearTimeout(preparationTimerRef.current);
  }, []);

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
  // ─── PROGRESSIVE GENERATION ─────────────────────────────────
  // examId identifies the FROZEN ExamBlueprint on the server; wording
  // fills in progressively via mode:'advance' while status==='generating'.
  const [examId, setExamId] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [authorityType, setAuthorityType] = useState<'studyal_material_enjoyer' | 'material_brain_legacy'>('studyal_material_enjoyer');
  const [authorityVersion, setAuthorityVersion] = useState<string | null>(null);
  const [generatorVersion, setGeneratorVersion] = useState<string | null>(null);
  const [totalSlots, setTotalSlots] = useState(0);
  const [readyCount, setReadyCount] = useState(0);
  const [genStatus, setGenStatus] = useState<'generating' | 'ready' | 'failed'>('ready');
  const [advancePaused, setAdvancePaused] = useState(false);
  const [advanceRetryTrigger, setAdvanceRetryTrigger] = useState(0);
  const advanceFailuresRef = useRef(0);
  const advanceTimerRef = useRef<number | null>(null);

  function resumeAdvance() {
    advanceFailuresRef.current = 0;
    setAdvancePaused(false);
    setAdvanceRetryTrigger(c => c + 1);
  }

  const advanceBusyRef = useRef(false);
  const evaluationBusyRef = useRef(false);
  const evaluationAttemptRef = useRef(0);
  const evaluationControllerRef = useRef<AbortController | null>(null);
  const [genStep, setGenStep] = useState(0);
  const [resultsTab, setResultsTab] = useState<ExamResultTab>('questions');

  const { reportEvent } = useMasteryReporter();
  const paperRef = useRef<HTMLDivElement | null>(null);
  const effectiveSourceSelection = useMemo(
    () => sourceSelection || buildSourceSelectionFromMaterials(materiales, seleccion),
    [sourceSelection, materiales, seleccion],
  );
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

  // ─── TIEMPO IDEAL GROUNDED (Material Enjoyer, 0 provider calls) ──
  // StudyAL-como-profesor: el estudiante solo elige tiempo. El universo
  // evaluable real (targets canónicos del Enjoyer) decide el tiempo
  // mínimo/ideal — nunca el tamaño del texto ni páginas×constante.
  useEffect(() => {
    if (!sessionId || phase !== 'setup') return;
    let cancelled = false;
    fetch('/api/alai-studyal-exam', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'recommend', sessionId }),
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled || !data?.success) return;
        const normalizedIdeal = [15, 30, 45, 60, 90].find(d => d >= data.idealDurationMinutes) ?? 90;
        setIdealDurationMinutes(normalizedIdeal);
        setMinimumViableMinutes(data.minimumViableDurationMinutes);
        setRecommendedMinutes(normalizedIdeal);
        if (!attemptIdRef.current) setDuration(normalizedIdeal);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId, effectiveSourceSelection.fingerprint, phase]);

  function calcRecommended(text: string) {
    const chars = text.length;
    const pages = selectedPagesArr.length || Math.max(1, Math.round(chars / 2500));
    const raw = (chars / 1500) + (pages * 2);
    const rec = raw < 25 ? 15 : raw < 55 ? 30 : raw < 110 ? 45 : raw < 200 ? 60 : 90;
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
          phase: 'exam', duration, recommendedMinutes: null, examId: null,
          authorityType: 'material_brain_legacy', authorityVersion: null, generatorVersion: null,
          totalSlots: 0, readyCount: 0, genStatus: 'ready',
          examMode: 'closed', adaptive: true,
          exam: legacy.exam, currentQuestion: Number(legacy.currentQuestion || 0),
          answers: Array.isArray(legacy.answers) ? legacy.answers : [],
          confidences: Array.isArray(legacy.confidences) ? legacy.confidences : [],
          draftAnswer: legacy.answers?.[legacy.currentQuestion] ?? '', draftConfidence: legacy.confidences?.[legacy.currentQuestion] ?? null,
          marked: Array.isArray(legacy.marked) ? legacy.marked : [], deadlineAt: null,
          paused: false, remainingSeconds: Number(legacy.remainingSeconds || duration * 60),
          questionTimes: [], evaluation: null, submissionError: '', pendingSubmissionAnswers: null,
          pendingSubmissionConfidences: null, resultsTab: 'questions',
        };
      }
    }
    if (saved?.attemptId && !saved.exam) {
      attemptIdRef.current = saved.attemptId;
      setAttemptId(saved.attemptId);
      setDuration(saved.duration);
      setRequestedDurationMinutes(saved.requestedDurationMinutes || saved.duration);
      setExamMode(saved.examMode);
      setAdaptive(saved.adaptive);
      setPhase('setup');
      if (saved.phase === 'generating') setGenError('La preparación se interrumpió. Pulsa Comenzar examen para continuar el mismo intento.');
      latestPersistPayloadRef.current = { sessionId: sessionId!, fingerprint: effectiveSourceSelection.fingerprint, state: saved };
    }
    if (saved?.exam) {
      setDuration(Number(saved.duration || 30));
      setRequestedDurationMinutes(Number(saved.requestedDurationMinutes || saved.duration || 30));
      setRecommendedMinutes(saved.recommendedMinutes ?? null);
      setExamMode(saved.examMode || 'closed');
      setAdaptive(saved.adaptive !== false);
      setExam(saved.exam);
      setExamId(saved.examId ?? null);
      setAttemptId(saved.attemptId ?? null);
      attemptIdRef.current = saved.attemptId ?? null;
      setAuthorityType(saved.authorityType || (saved.examId ? 'studyal_material_enjoyer' : 'material_brain_legacy'));
      setAuthorityVersion(saved.authorityVersion ?? null);
      setGeneratorVersion(saved.generatorVersion ?? null);
      setTotalSlots(saved.totalSlots ?? saved.exam.questions?.length ?? 0);
      setReadyCount(saved.readyCount ?? saved.exam.questions?.filter((q: ExamQuestion) => q.ready !== false).length ?? 0);
      setGenStatus(saved.genStatus || 'ready');
      setCurrentQuestion(Math.max(0, Number(saved.currentQuestion || 0)));
      setAnswers(Array.isArray(saved.answers) ? saved.answers : []);
      setConfidences(Array.isArray(saved.confidences) ? saved.confidences : []);
      setDraftAnswer(saved.draftAnswer ?? defaultAnswerFor(saved.exam.questions?.[saved.currentQuestion || 0]?.type));
      setDraftConfidence(saved.draftConfidence ?? null);
      setMarked(new Set(Array.isArray(saved.marked) ? saved.marked : []));
      // Only an EXAM phase (timer already started) gets a synthesized
      // fallback deadline on resume — PREVIEW never fabricates one
      // (generation/preparation time must never consume exam time).
      setDeadlineAt(saved.phase === 'exam'
        ? (saved.deadlineAt || (Date.now() + Math.max(0, Number(saved.remainingSeconds || 0)) * 1000))
        : (saved.deadlineAt ?? null));
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
      setResultsTab((saved.resultsTab as ExamResultTab) || 'questions');
      setPhase(saved.phase === 'evaluating' ? 'exam' : saved.phase);
    }
    setContinuityReady(true);
  }, [sessionId, effectiveSourceSelection.fingerprint]);

  const latestPersistPayloadRef = useRef<{ sessionId: string; fingerprint: string; state: PersistedExamState } | null>(null);
  useEffect(() => {
    if (!continuityReady || !sessionId || !exam) return;
    const state: PersistedExamState = {
      phase, duration, requestedDurationMinutes, recommendedMinutes, examId, attemptId, authorityType, authorityVersion, generatorVersion,
      totalSlots, readyCount, genStatus,
      examMode, adaptive, exam, currentQuestion,
      answers, confidences, draftAnswer, draftConfidence, marked: [...marked], deadlineAt,
      paused, remainingSeconds, questionTimes, evaluation, submissionError,
      pendingSubmissionAnswers, pendingSubmissionConfidences, resultsTab,
    };
    latestPersistPayloadRef.current = { sessionId, fingerprint: effectiveSourceSelection.fingerprint, state };
    const timer = setTimeout(() => {
      writeFreeToolState(sessionId, effectiveSourceSelection.fingerprint, 'exam', state);
      try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {}
    }, 300);
    persistTimerRef.current = timer;
    return () => clearTimeout(timer);
  }, [
    continuityReady, sessionId, effectiveSourceSelection.fingerprint, phase, duration,
    requestedDurationMinutes, recommendedMinutes, examId, attemptId, authorityType, authorityVersion, generatorVersion, totalSlots, readyCount, genStatus,
    examMode, adaptive, exam, currentQuestion, answers, confidences,
    draftAnswer, draftConfidence, marked, deadlineAt, paused, questionTimes, evaluation,
    submissionError, pendingSubmissionAnswers, pendingSubmissionConfidences, resultsTab, storageKey,
  ]);

  useEffect(() => () => {
    generationAttemptRef.current += 1;
    generationControllerRef.current?.abort();
    evaluationAttemptRef.current += 1;
    evaluationControllerRef.current?.abort();
  }, []);

  // Flush the LATEST pending write synchronously on true unmount (e.g. a
  // fast "Volver al proceso" click) so it can never race the 300ms debounce
  // above and silently lose state.
  useEffect(() => () => {
    const pending = latestPersistPayloadRef.current;
    if (pending) {
      writeFreeToolState(pending.sessionId, pending.fingerprint, 'exam', pending.state);
    }
  }, []);

  // Persist intent even before the server has returned the first artifact.
  function persistAttemptIntent(id: string, intentPhase: 'setup' | 'generating') {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    const state: PersistedExamState = {
      phase: intentPhase, attemptId: id, duration, requestedDurationMinutes: duration,
      recommendedMinutes, examId: null, totalSlots: 0, readyCount: 0, genStatus: 'generating',
      examMode, adaptive, exam: null, currentQuestion: 0, answers: [], confidences: [],
      draftAnswer: '', draftConfidence: null, marked: [], deadlineAt: null, paused: false,
      remainingSeconds: duration * 60, questionTimes: [], evaluation: null, submissionError: '',
      pendingSubmissionAnswers: null, pendingSubmissionConfidences: null, resultsTab: 'questions',
    };
    latestPersistPayloadRef.current = sessionId
      ? { sessionId, fingerprint: effectiveSourceSelection.fingerprint, state } : null;
    writeFreeToolState(sessionId, effectiveSourceSelection.fingerprint, 'exam', state);
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {}
  }

  // ─── GENERATE ───────────────────────────────────────────────
  async function generateExam() {
    if (!sessionId) { setGenError('No hay sesión activa para generar el examen.'); return; }
    if (generationBusyRef.current) return;
    generationBusyRef.current = true;
    const attempt = ++generationAttemptRef.current;
    generationControllerRef.current?.abort();
    const controller = new AbortController();
    generationControllerRef.current = controller;
    const activeAttempt = attemptIdRef.current || (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : (`att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`));
    attemptIdRef.current = activeAttempt;
    setAttemptId(activeAttempt);
    persistAttemptIntent(activeAttempt, 'generating');
    setPhase('generating'); setGenError(''); setPreparingMessage(null);
    try {
      // Academic authority: the server restores the exact persisted
      // Material Enjoyer for this Free session. No raw material is sent.
      const res = await fetch('/api/alai-studyal-exam', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          // StudyAL-como-profesor: el estudiante SOLO eligió tiempo. El
          // composer decide count/types/difficulty — no se envían.
          mode: 'generate', sessionId, materia: materia?.nombre || '', tema: tema?.nombre || '',
          durationMinutes: duration,
          attemptId: activeAttempt,
        }),
      });
      const data = await res.json();
      if (controller.signal.aborted || generationAttemptRef.current !== attempt) return;
      if (res.status === 409 && data?.error === 'ENJOYER_NOT_READY') {
        const nextAttempt = preparationAttemptRef.current + 1;
        preparationAttemptRef.current = nextAttempt;
        setPreparingMessage('Preparando el análisis académico del material…');
        setGenError('');
        if (nextAttempt < 20) {
          preparationTimerRef.current = setTimeout(() => { void generateExam(); }, 1500);
        } else {
          setGenError('El análisis académico aún no está listo. Puedes reintentar en unos segundos.');
          setPhase('setup');
        }
        return;
      }
      if (!res.ok || !data.success) throw new Error(data.error || `Error ${res.status}`);
      if (!data.exam?.questions?.length) throw new Error('ALAI no generó preguntas.');

      const newExam = data.exam as GeneratedExam;
      const requestedMinutes = Number(data.blueprint?.requestedDurationMinutes || duration);
      const effectiveMinutes = Number(data.blueprint?.effectiveDurationMinutes || data.blueprint?.durationMinutes || duration);
      setExam(newExam);
      setExamId(data.exam.id);
      setAuthorityType('studyal_material_enjoyer');
      setAuthorityVersion(data.blueprint?.authorityVersion || null);
      setGeneratorVersion(data.blueprint?.generatorVersion || null);
      setTotalSlots(data.totalSlots ?? newExam.questions.length);
      setReadyCount(data.readyCount ?? newExam.questions.filter(q => q.ready !== false).length);
      setGenStatus(data.status || 'ready');
      if (data.recommendedMinutes) setRecommendedMinutes(data.recommendedMinutes);
      setRequestedDurationMinutes(requestedMinutes);
      setDuration(effectiveMinutes);
      setAnswers(newExam.questions.map(q => defaultAnswerFor(q.type)));
      setConfidences(newExam.questions.map(() => null));
      setQuestionTimes(newExam.questions.map(() => 0));
      questionStartRef.current = Date.now();
      setDraftAnswer(defaultAnswerFor(newExam.questions[0]?.type));
      setDraftConfidence(null);
      setCurrentQuestion(0);
      setRemainingSeconds(duration * 60);
      setMarked(new Set());
      setEvaluation(null);
      setSubmissionError('');
      setPendingSubmissionAnswers(null);
      setPendingSubmissionConfidences(null);
      // PREPARING → READY_TO_START. The timer does NOT start here — only
      // an explicit "Comenzar examen" click (startExam()) sets deadlineAt.
      // Generation time never consumes exam time.
      setPhase('preview');
      window.setTimeout(() => paperRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);

      // Persist the freshly generated exam SYNCHRONOUSLY (not via the
      // debounced continuity effect) so a "Volver al proceso" click right
      // after generation can never race the debounce and lose it — this
      // is also the moment Examen's Free-process cap is earned
      // (lib/freeToolState.ts reads this same envelope: Boolean(state.exam)).
      if (sessionId) {
        const savedPreview = writeFreeToolState<PersistedExamState>(sessionId, effectiveSourceSelection.fingerprint, 'exam', {
          phase: 'preview', duration: effectiveMinutes, requestedDurationMinutes: requestedMinutes,
          recommendedMinutes: data.recommendedMinutes || recommendedMinutes,
          attemptId: activeAttempt, examId: data.exam.id, totalSlots: data.totalSlots ?? newExam.questions.length,
          authorityType: 'studyal_material_enjoyer', authorityVersion: data.blueprint?.authorityVersion || null,
          generatorVersion: data.blueprint?.generatorVersion || null,
          readyCount: data.readyCount ?? newExam.questions.filter(q => q.ready !== false).length,
          genStatus: data.status || 'ready',
          examMode, adaptive, exam: newExam,
          currentQuestion: 0, answers: newExam.questions.map(q => defaultAnswerFor(q.type)),
          confidences: newExam.questions.map(() => null), draftAnswer: defaultAnswerFor(newExam.questions[0]?.type),
          draftConfidence: null, marked: [], deadlineAt: null,
          paused: false, remainingSeconds: duration * 60, questionTimes: newExam.questions.map(() => 0),
          evaluation: null, submissionError: '', pendingSubmissionAnswers: null,
          pendingSubmissionConfidences: null, resultsTab,
        });
        if (savedPreview) latestPersistPayloadRef.current = {
          sessionId, fingerprint: effectiveSourceSelection.fingerprint, state: savedPreview.state,
        };
      }
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

  const canStartExam = phase === 'preview' && !advancePaused && !paused
    && isExamFullyReady(exam, genStatus, readyCount, totalSlots);
  const canStartExamRef = useRef(canStartExam);
  canStartExamRef.current = canStartExam;
  useEffect(() => () => { canStartExamRef.current = false; }, []);

  /** User clicks "Comenzar examen" — ONLY here does the timer start. */
  function startExam() {
    if (!exam || genStatus !== 'ready' || readyCount !== totalSlots || !canStartExamRef.current) return;
    const newDeadline = Date.now() + duration * 60 * 1000;
    setDeadlineAt(newDeadline);
    setPhase('exam');
    if (sessionId) {
      writeFreeToolState<PersistedExamState>(sessionId, effectiveSourceSelection.fingerprint, 'exam', {
        phase: 'exam', duration, recommendedMinutes, examId, attemptId, authorityType, authorityVersion, generatorVersion,
        totalSlots, readyCount, genStatus,
        examMode, adaptive, exam,
        currentQuestion, answers, confidences, draftAnswer, draftConfidence,
        marked: Array.from(marked), deadlineAt: newDeadline, paused: false,
        remainingSeconds: duration * 60, questionTimes, evaluation: null,
        submissionError: '', pendingSubmissionAnswers: null, pendingSubmissionConfidences: null, resultsTab,
      });
    }
  }

  // ─── BACKGROUND ADVANCE — fills remaining frozen slots ─────────
  // Client-driven, request/response only (no unawaited server Promise).
  // Sequentially advances pending frozen slots until all are ready.
  useEffect(() => {
    if (!examId || !sessionId || genStatus !== 'generating') return;
    if (phase !== 'preview') return;
    if (advancePaused) return;

    let cancelled = false;
    const clearTimer = () => {
      if (advanceTimerRef.current !== null) {
        window.clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
    };
    clearTimer();

    const scheduleNext = (delayMs: number) => {
      clearTimer();
      if (cancelled) return;
      advanceTimerRef.current = window.setTimeout(tick, delayMs);
    };

    const tick = async () => {
      if (cancelled || advanceBusyRef.current) return;
      if (readyCount >= totalSlots) return;
      advanceBusyRef.current = true;
      try {
        const res = await fetch('/api/alai-studyal-exam', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'advance', sessionId, examId }),
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;

        // Consume valid server generation status before treating !success as an exit reason
        if (data?.status === 'generating' || data?.status === 'ready' || data?.status === 'failed') {
          setGenStatus(data.status);
        }
        if (typeof data?.totalSlots === 'number') {
          setTotalSlots(data.totalSlots);
        }
        if (typeof data?.readyCount === 'number') {
          setReadyCount(data.readyCount);
        }
        if (data?.exam) {
          setExam(prev => {
            if (!prev) return data.exam;
            const merged = prev.questions.map((oldQ, i) => {
              const newQ = data.exam.questions[i];
              return newQ && newQ.ready !== false ? newQ : oldQ;
            });
            return { ...data.exam, questions: merged };
          });
        }

        if (data?.status === 'ready' || (typeof data?.readyCount === 'number' && typeof data?.totalSlots === 'number' && data.readyCount >= data.totalSlots)) {
          clearTimer();
          return;
        }
        if (data?.status === 'failed') {
          clearTimer();
          return;
        }

        if (res.ok && data?.success) {
          advanceFailuresRef.current = 0;
          scheduleNext(1500);
        } else {
          advanceFailuresRef.current += 1;
          const delay = getAdvanceBackoffDelay(advanceFailuresRef.current);
          if (delay === null) {
            setAdvancePaused(true);
            clearTimer();
          } else {
            scheduleNext(delay);
          }
        }
      } catch {
        if (cancelled) return;
        advanceFailuresRef.current += 1;
        const delay = getAdvanceBackoffDelay(advanceFailuresRef.current);
        if (delay === null) {
          setAdvancePaused(true);
          clearTimer();
        } else {
          scheduleNext(delay);
        }
      } finally {
        advanceBusyRef.current = false;
      }
    };

    tick();
    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [examId, sessionId, phase, genStatus, readyCount, totalSlots, advancePaused, advanceRetryTrigger]);

  // ─── ADAPTACIÓN DINÁMICA — RETIRADA DEL PRODUCTO ────────────
  // El blueprint se congela por completo antes de empezar el examen
  // (StudyAL-como-profesor); ya no hay "mid-exam adaptation". Esta
  // función queda como no-op para no tocar los call sites existentes;
  // el servidor (`mode: 'adapt'`) sigue existiendo pero nunca se llama
  // desde este flujo (ver EXAM-STATIC contracts).
  const lastAdaptedAt = useRef(0);
  async function maybeAdapt() {
    return;
    // eslint-disable-next-line no-unreachable
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
        phase: 'evaluating', duration, recommendedMinutes, examId, attemptId, authorityType, authorityVersion, generatorVersion,
        totalSlots, readyCount, genStatus,
        examMode, adaptive, exam,
        currentQuestion, answers: finals, confidences: finalsConf, draftAnswer,
        draftConfidence, marked: [...marked], deadlineAt, paused: true, remainingSeconds,
        questionTimes, evaluation: null, submissionError: '',
        pendingSubmissionAnswers: finals, pendingSubmissionConfidences: finalsConf, resultsTab,
      });
    }
    try {
      let data: any = null;
      let previousPendingCriteria = Number.POSITIVE_INFINITY;
      for (;;) {
        const res = await fetch('/api/alai-studyal-exam', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            mode: 'evaluate', sessionId, examId, answers: finals, confidences: finalsConf, questionTimes,
          }),
        });
        data = await res.json();
        if (controller.signal.aborted || attempt !== evaluationAttemptRef.current) return;
        if (res.ok && data.success) break;

        const pendingCriteria = Number(data?.partialEvaluation?.pendingCriteria);
        const canContinue = data?.retryable === true
          && data?.partialEvaluation?.canContinue === true
          && Number.isFinite(pendingCriteria)
          && pendingCriteria < previousPendingCriteria;
        if (canContinue) {
          previousPendingCriteria = pendingCriteria;
          if (data?.partialEvaluation) setEvaluation(data.partialEvaluation);
          continue;
        }

        if (data?.partialEvaluation) setEvaluation(data.partialEvaluation);
        const failure = new Error(examGradingFailureMessage(data)) as Error & { preservePartialEvaluation?: boolean };
        failure.preservePartialEvaluation = Boolean(data?.partialEvaluation);
        throw failure;
      }
      if (!data?.success) {
        const failure = new Error(examGradingFailureMessage(data)) as Error & { preservePartialEvaluation?: boolean };
        failure.preservePartialEvaluation = Boolean(data?.partialEvaluation);
        throw failure;
      }
      setEvaluation(data.evaluation);
      setPendingSubmissionAnswers(null);
      setPendingSubmissionConfidences(null);
      setSubmissionError('');

      // ── Mastery Engine: reportar resultado de Examen (Adaptive concept tracking) ──
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
          });
        }
      } catch (_) {}

      setPhase('results');
      window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 80);
    } catch (error: any) {
      if (controller.signal.aborted || attempt !== evaluationAttemptRef.current) return;
      if (!error?.preservePartialEvaluation) setEvaluation(null);
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
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    latestPersistPayloadRef.current = null;
    setPhase('setup');
    setExam(null);
    setExamId(null);
    const nextAttempt = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : (`att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    attemptIdRef.current = nextAttempt;
    setAttemptId(nextAttempt);
    setAnswers([]);
    setConfidences([]);
    setQuestionTimes([]);
    setDraftAnswer('');
    setDraftConfidence(null);
    setCurrentQuestion(0);
    setEvaluation(null);
    setRemainingSeconds(duration * 60);
    setDeadlineAt(null);
    setSubmissionError('');
    setPendingSubmissionAnswers(null);
    setPendingSubmissionConfidences(null);
    setGenError('');
    setPreparingMessage(null);
    setTotalSlots(0);
    setReadyCount(0);
    setGenStatus('ready');
    setMarked(new Set());
    setPaused(false);
    setResultsTab('questions');
    lastAdaptedAt.current = 0;
    try { localStorage.removeItem(storageKey); } catch {}
    if (sessionId) {
      clearFreeToolState(sessionId, effectiveSourceSelection.fingerprint, 'exam');
      try { updateSessionById(sessionId, s => ({ ...s, notes: { ...(s.notes || {}), freeExam: undefined } })); } catch {}
    }
    persistAttemptIntent(nextAttempt, 'setup');
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 999999, background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: BODY, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, maxWidth: 1400, width: '100%', margin: '0 auto', padding: phase === 'exam' ? '16px 28px 0' : '24px 28px 60px', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: phase === 'exam' ? 'hidden' : 'auto' }}>

        {/* ═══ SETUP ═══ */}
        {phase === 'setup' && (<>
          <button onClick={onBack} style={btnSecondary}>← Volver al proceso</button>

          <section style={{ border: '1.5px solid var(--gold-border)', background: 'linear-gradient(135deg, rgba(33,18,4,.55), rgba(9,9,12,.94))', borderRadius: 22, padding: '32px 36px', margin: '24px 0' }}>
            <div style={{ color: 'var(--gold)', letterSpacing: 1.6, fontWeight: 900, fontSize: 12 }}>EVALUACIÓN FINAL ADAPTATIVA</div>
            <h1 style={{ margin: '12px 0 8px', fontSize: 38, lineHeight: 1, fontWeight: 900 }}>🧠 Examen ALAI</h1>
            <p style={{ color: 'var(--text-faint)', fontSize: 15, lineHeight: 1.65, maxWidth: 760, margin: 0 }}>
              Examen real que se <strong style={{ color: 'var(--gold)' }}>adapta a ti</strong>. Si vas bien sube de dificultad. Si fallas en una habilidad, refuerza ahí.
              Mide qué tan seguro estás de cada respuesta para detectar dónde crees que sabes pero no sabes.
            </p>
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 24, alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 18 }}>
              <section style={cardDark}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 22 }}>📋</span>
                  <h2 style={{ margin: 0, fontSize: 17, color: 'var(--gold)', letterSpacing: 1.5, fontWeight: 900 }}>QUÉ EVALÚA</h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  {(Object.keys(SKILL_LABEL) as Skill[]).map(s => (
                    <div key={s} style={{ border: '1px solid var(--gold-dim)', background: 'var(--bg-card)', borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontSize: 18 }}>{SKILL_ICON[s]}</span>
                      <div style={{ fontWeight: 900, fontSize: 13, color: 'var(--gold)' }}>{SKILL_LABEL[s]}</div>
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
                      border: examMode === m ? '2px solid var(--gold)' : '1px solid var(--border-color)',
                      background: examMode === m ? 'var(--gold-dim)' : 'var(--bg-card)',
                      color: examMode === m ? 'var(--gold)' : 'var(--text-faint)',
                    }}>
                      <div style={{ fontWeight: 900, fontSize: 14 }}>{m === 'closed' ? '📝 Cerrado' : '📖 Abierto'}</div>
                      <div style={{ fontSize: 11, opacity: .7, marginTop: 2 }}>{m === 'closed' ? 'Sin consultar material' : 'Puedes revisar el material'}</div>
                    </button>
                  ))}
                </div>

              </section>
            </div>

            <div style={cardDark}>
              <div style={{ marginBottom: 18 }}>
                <div style={lblSection}>TIEMPO IDEAL — STUDYAL COMPONE TODO LO DEMÁS</div>
                <button onClick={() => idealDurationMinutes && setDuration(idealDurationMinutes)} disabled={!idealDurationMinutes}
                  style={{ width: '100%', padding: '14px 18px', borderRadius: 12, border: duration === idealDurationMinutes ? '2px solid var(--gold)' : '1.5px solid var(--gold-border)', background: duration === idealDurationMinutes ? 'linear-gradient(135deg, var(--gold-dim), rgba(245,200,66,.06))' : 'rgba(245,200,66,.06)', color: 'var(--gold)', fontWeight: 900, fontSize: 15, cursor: idealDurationMinutes ? 'pointer' : 'not-allowed', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>✦</span>{idealDurationMinutes ? `${idealDurationMinutes} min` : '···'}
                  </span>
                  {duration === idealDurationMinutes && <span>✓</span>}
                </button>
                {minimumViableMinutes != null && duration < minimumViableMinutes && (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-faint)' }}>
                    {minimumViableMinutes > 90
                      ? `Material extenso: StudyAL compondrá una evaluación representativa de ${duration} min.`
                      : `Para evaluar todo este material sin muestreo, el tiempo sugerido es ${[15, 30, 45, 60, 90].find(d => d >= minimumViableMinutes) ?? 90} min.`}
                  </div>
                )}
              </div>

              <div style={lblSection}>DURACIÓN</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                {[15, 30, 45, 60, 90].map(d => (
                  <button key={d} onClick={() => setDuration(d)} style={{ padding: '12px 6px', borderRadius: 10, cursor: 'pointer', border: duration === d ? '2px solid var(--gold)' : '1px solid var(--border-color)', background: duration === d ? 'var(--gold-dim)' : 'var(--bg-card)', color: duration === d ? 'var(--gold)' : 'var(--text-faint)', fontWeight: 800, fontSize: 13 }}>{d} min</button>
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

              <button onClick={generateExam} disabled={loadingText} style={{ marginTop: 22, width: '100%', padding: 16, borderRadius: 12, border: 'none', background: loadingText ? '#555' : 'var(--gold)', color: '#080808', fontWeight: 950, fontSize: 14, letterSpacing: 1, cursor: loadingText ? 'not-allowed' : 'pointer' }}>
                {loadingText ? 'CARGANDO MATERIAL...' : 'COMENZAR EXAMEN →'}
              </button>
            </div>
          </div>
        </>)}

        {/* ═══ GENERATING ═══ */}
        {phase === 'generating' && (
          <section style={{ minHeight: '85vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{ color: 'var(--gold)', letterSpacing: 4, fontWeight: 900, fontSize: 13, marginBottom: 14 }}>STUDYAL · EXAMEN ALAI</div>
              <h1 style={{ margin: 0, fontSize: 36, fontWeight: 900 }}>
                {/* Preparación localizada del Examen — mensaje propio,
                    continúa solo, nunca un error genérico. */}
                {preparingMessage || 'ALAI está construyendo tu examen'}
              </h1>
              <p style={{ color: 'var(--text-faint)', fontSize: 15, lineHeight: 1.6, marginTop: 14, maxWidth: 580 }}>{preparingMessage ? 'Free Mode sigue abierto: puedes usar ALAI Chat, Repasar, Flashcards y Análisis mientras tanto.' : 'Extrayendo conceptos, calculando dificultad y generando preguntas adaptativas.'}</p>
            </div>
            <div style={{ position: 'relative', width: 200, height: 200, marginBottom: 40, display: 'grid', placeItems: 'center' }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid transparent', borderTopColor: 'var(--gold)', borderRightColor: 'var(--gold-border)', animation: 'brainSpin 2.5s linear infinite', boxShadow: '0 0 40px var(--gold-border)' }} />
              <div style={{ fontSize: 80, animation: 'brainPulse 2s ease-in-out infinite', filter: 'drop-shadow(0 0 18px rgba(245,200,66,.55))' }}>🧠</div>
            </div>
            <div style={{ width: '100%', maxWidth: 820, position: 'relative', marginBottom: 36 }}>
              <div style={{ position: 'absolute', left: '8%', right: '8%', top: 28, height: 2, background: 'var(--gold-dim)' }}>
                <div style={{ height: '100%', width: `${(genStep / (genSteps.length - 1)) * 100}%`, background: 'var(--gold)', transition: 'width .8s ease' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${genSteps.length}, 1fr)`, gap: 8, position: 'relative' }}>
                {genSteps.map((step, i) => {
                  const active = i === genStep, done = i < genStep;
                  return (<div key={i} style={{ textAlign: 'center' }}>
                    <div style={{ width: 56, height: 56, margin: '0 auto', borderRadius: '50%', background: active ? 'var(--gold)' : done ? 'var(--gold-dim)' : 'var(--bg-card)', border: active ? '2px solid var(--gold)' : done ? '2px solid var(--gold-border)' : '2px solid var(--border-color)', display: 'grid', placeItems: 'center', fontSize: 22, color: active ? '#080808' : done ? 'var(--gold)' : 'var(--text-faint)' }}>{step.icon}</div>
                    <div style={{ marginTop: 10, fontSize: 12, color: active ? 'var(--gold)' : done ? 'var(--text-faint)' : 'var(--text-faint)', fontWeight: active ? 900 : 700 }}>{i + 1}. {step.label}</div>
                  </div>);
                })}
              </div>
            </div>
          </section>
        )}

        {/* ═══ PREVIEW — StudyAL-como-profesor: resumen no editable ═══ */}
        {phase === 'preview' && exam && (
          <section style={{ minHeight: '85vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', marginBottom: 28, maxWidth: 560 }}>
              <div style={{ color: 'var(--gold)', letterSpacing: 4, fontWeight: 900, fontSize: 13, marginBottom: 14 }}>STUDYAL · EXAMEN ALAI</div>
              {genStatus === 'failed' ? (
                <>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
                  <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900 }}>No se pudo completar el examen</h1>
                  <p style={{ color: 'var(--text-faint)', fontSize: 15, lineHeight: 1.6, marginTop: 14 }}>
                    {readyCount} de {totalSlots} preguntas quedaron listas.
                  </p>
                </>
              ) : (
                <>
                  <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900 }}>Tu examen está listo</h1>
                  <p style={{ color: 'var(--text-faint)', fontSize: 15, lineHeight: 1.6, marginTop: 14 }}>
                    {genStatus === 'generating'
                      ? 'Las primeras preguntas ya están listas. El resto se sigue preparando en segundo plano — puedes empezar ya.'
                      : 'Todas las preguntas están listas.'}
                  </p>
                </>
              )}
            </div>
            {genStatus !== 'failed' && (
              <div style={{ display: 'flex', gap: 24, marginBottom: 32, flexWrap: 'wrap', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center', minWidth: 120 }}>
                  <div style={{ fontSize: 30, fontWeight: 950, color: 'var(--gold)' }}>{duration} min</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: 1 }}>DURACIÓN</div>
                </div>
                <div style={{ textAlign: 'center', minWidth: 120 }}>
                  <div style={{ fontSize: 30, fontWeight: 950, color: 'var(--gold)' }}>{totalSlots}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: 1 }}>PREGUNTAS</div>
                </div>
                <div style={{ textAlign: 'center', minWidth: 140 }}>
                  <div style={{ fontSize: 30, fontWeight: 950, color: 'var(--gold)' }}>Mixta</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: 1 }}>DIFICULTAD</div>
                </div>
              </div>
            )}
            {advancePaused && (
              <div style={{
                margin: '0 auto 24px auto',
                padding: '16px 20px',
                borderRadius: 12,
                background: 'rgba(255, 193, 7, 0.08)',
                border: '1px solid rgba(255, 193, 7, 0.25)',
                maxWidth: 480,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5, fontWeight: 500 }}>
                  La preparación está pausada temporalmente. Tus preguntas guardadas se conservan.
                </p>
                <button
                  type="button"
                  onClick={resumeAdvance}
                  style={{
                    marginTop: 14,
                    padding: '10px 24px',
                    borderRadius: 10,
                    border: 'none',
                    background: 'var(--gold)',
                    color: '#080808',
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: 'pointer',
                    letterSpacing: 0.5,
                  }}
                >
                  Reintentar preparación
                </button>
              </div>
            )}
            {genStatus === 'generating' && (
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 20 }}>
                {readyCount} de {totalSlots} preguntas listas{advancePaused ? ' (en pausa)' : readyCount === totalSlots - 1 ? ' — Estamos terminando la última pregunta…' : ' — Preparando el resto…'}
              </div>
            )}
            {genStatus === 'failed' ? (
              <button onClick={onBack} style={{ ...btnSecondary, marginTop: 8 }}>← Salir</button>
            ) : (
              <>
                {canStartExam && <button data-testid="exam-start-taking" onClick={startExam} style={{ padding: '16px 48px', borderRadius: 12, border: 'none', background: 'var(--gold)', color: '#080808', fontWeight: 950, fontSize: 15, letterSpacing: 1, cursor: 'pointer' }}>
                  Comenzar examen
                </button>}
                <button onClick={onBack} style={{ ...btnSecondary, marginTop: 16 }}>← Salir</button>
              </>
            )}
          </section>
        )}

        {/* ═══ EXAM ═══ */}
        {phase === 'exam' && exam && (() => {
          const q = questions[currentQuestion];
          const qReady = q?.ready !== false;
          const isLast = currentQuestion === questions.length - 1;
          const currentSourcePage = Number(q?.sourcePage) || undefined;
          if (!qReady) {
            if (genStatus === 'failed') {
              return (
                <section style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                  <div style={{ fontSize: 40 }}>⚠️</div>
                  <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: 'var(--text-primary)' }}>
                    No se pudo completar el examen.
                  </h2>
                  <div style={{ color: 'var(--text-faint)', fontWeight: 700 }}>
                    {readyCount} de {totalSlots} preguntas quedaron listas.
                  </div>
                  <button onClick={onBack} style={{ ...btnSecondary, marginTop: 16 }}>← Salir</button>
                </section>
              );
            }
            return (
              <section style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                <div style={{ fontSize: 40 }}>🧠</div>
                <div style={{ color: 'var(--text-faint)', fontWeight: 700 }}>Preparando la siguiente pregunta…</div>
              </section>
            );
          }
          return (<>
            <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
              <button onClick={onBack} style={btnSecondary}>← Salir</button>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ color: 'var(--gold)', fontWeight: 900, letterSpacing: 2, fontSize: 11 }}>STUDYAL · EXAMEN ALAI {adaptive && '· ADAPTATIVO'}</div>
                <div style={{ fontSize: 18, fontWeight: 900, marginTop: 2 }}>{exam.title}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowPdf(v => !v)} style={{ padding: '10px 14px', borderRadius: 10, background: showPdf ? 'var(--gold-dim)' : 'var(--bg-card)', border: '1px solid var(--border-color)', color: showPdf ? 'var(--gold)' : 'var(--text-primary)', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
                  📄 {showPdf ? 'Ocultar PDF' : 'Ver PDF'}
                </button>
                <button onClick={togglePause} style={{ padding: '10px 14px', borderRadius: 10, background: paused ? 'var(--gold-dim)' : 'var(--bg-card)', border: '1px solid var(--border-color)', color: paused ? 'var(--gold)' : 'var(--text-primary)', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
                  {paused ? '▶ Reanudar' : '⏸ Pausar'}
                </button>
              </div>
            </header>

            {paused && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(0,0,0,.88)', display: 'grid', placeItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 60 }}>⏸</div>
                  <h1 style={{ color: 'var(--gold)' }}>Examen pausado</h1>
                  {submissionError ? (
                    <>
                      <p style={{ color: '#fecaca', maxWidth: 520 }}>{submissionError}</p>
                      <button onClick={retryEvaluation} style={{ marginTop: 20, padding: '16px 32px', borderRadius: 12, border: 'none', background: 'var(--gold)', color: '#080808', fontWeight: 950, fontSize: 16, cursor: 'pointer' }}>Reintentar corrección</button>
                    </>
                  ) : (
                    <button onClick={togglePause} style={{ marginTop: 20, padding: '16px 32px', borderRadius: 12, border: 'none', background: 'var(--gold)', color: '#080808', fontWeight: 950, fontSize: 16, cursor: 'pointer' }}>Continuar →</button>
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
                  background: 'var(--bg-card)',
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid var(--border-color)',
                  display: 'flex', flexDirection: 'column',
                  minHeight: 0,
                }}>
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 8 }}>
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
                      themeColor="var(--gold)"
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
              <ExamPaperHeader
                materia={materia}
                tema={tema}
                userName={userName}
                duration={duration}
                today={today}
                selectedPagesLabel={selectedPagesLabel}
                stats={[
                  { icon: '⏱', label: 'TIEMPO', value: mins + ':' + secs, highlight: timePercent < 0.25 },
                  { label: 'PROGRESO', value: progress + '%' },
                  { label: 'PREGUNTA', value: (currentQuestion + 1) + '/' + questions.length },
                ]}
              />

              <div style={{ textAlign: 'center', fontWeight: 700, letterSpacing: 2, marginBottom: 22, fontSize: 14 }}>{q.section}</div>

              <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', marginBottom: 6 }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{currentQuestion + 1}.</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5 }}><AcademicContent inline content={q.prompt} /></div>
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
            <div style={{ maxWidth: 900, margin: '16px auto 0', display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'center', padding: '12px 16px', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-color)' }}>
              {questions.map((_, i) => {
                const isCurrent = i === currentQuestion;
                const isMarked = marked.has(i);
                const done = isAnswered(answers[i]);
                const bg = isCurrent ? 'var(--gold)' : isMarked ? '#f59e0b' : done ? '#16a34a' : 'var(--bg-card)';
                const color = isCurrent || isMarked || done ? '#000' : 'var(--text-faint)';
                return (
                  <button key={i} onClick={() => goTo(i)} title={'Pregunta ' + (i + 1)} style={{ width: 28, height: 28, borderRadius: 6, border: isCurrent ? '2px solid var(--text-primary)' : '1px solid var(--border-color)', background: bg, color, fontWeight: 800, fontSize: 10, cursor: 'pointer', display: 'grid', placeItems: 'center', position: 'relative', flexShrink: 0 }}>
                    {i + 1}
                    {isMarked && <span style={{ position: 'absolute', top: -5, right: -5, fontSize: 9 }}>🚩</span>}
                  </button>
                );
              })}
            </div>

            <div style={{ maxWidth: 900, margin: '14px auto 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button disabled={currentQuestion === 0} onClick={() => goTo(currentQuestion - 1)} style={{ padding: '12px 20px', borderRadius: 10, border: '1px solid var(--border-color)', background: currentQuestion === 0 ? 'var(--bg-card)' : 'var(--bg-card2)', color: currentQuestion === 0 ? 'var(--text-faint)' : 'var(--text-primary)', cursor: currentQuestion === 0 ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 13 }}>← Anterior</button>
              <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>{answeredCount}/{questions.length} respondidas</div>
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
              <p style={{ color: 'var(--text-faint)', marginTop: 10 }}>Evaluando {questions.length} preguntas + calibración de confianza.</p>
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
            materia={materia}
            tema={tema}
            userName={userName}
            duration={duration}
            today={today}
            selectedPagesLabel={selectedPagesLabel}
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
          <span><AcademicContent inline content={opt} /></span>
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

  if (q.type === 'multi_select') {
    const selected: number[] = Array.isArray(value) ? value : [];
    const toggle = (idx: number) => onChange(selected.includes(idx) ? selected.filter(i => i !== idx) : [...selected, idx]);
    return (<div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontFamily: BODY, fontSize: 12, color: '#666', marginBottom: 2 }}>Selecciona TODAS las que apliquen.</div>
      {(q.options || []).map((opt, idx) => {
        const sel = selected.includes(idx);
        return (<button key={idx} onClick={() => toggle(idx)} style={{ textAlign: 'left', padding: '12px 16px', borderRadius: 6, border: sel ? '2px solid #111' : '1px solid rgba(0,0,0,.22)', background: sel ? '#fef9e7' : '#fff', cursor: 'pointer', fontFamily: SERIF, fontSize: 14, display: 'flex', gap: 12, alignItems: 'center', color: '#111' }}>
          <span style={{ width: 22, height: 22, borderRadius: 4, border: '1.5px solid #111', display: 'grid', placeItems: 'center', fontWeight: 800, background: sel ? '#111' : 'transparent', color: sel ? '#fff' : '#111', flexShrink: 0, fontSize: 12 }}>{sel ? '✓' : ''}</span>
          <span><AcademicContent inline content={opt} /></span>
        </button>);
      })}
    </div>);
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

export function FillBlankRenderer({ q, value, onChange, onSubmit, canSubmit, disabled }: { q: ExamQuestion; value: any; onChange: (v: any) => void; onSubmit?: () => void; canSubmit?: boolean; disabled?: boolean }) {
  const bank = q.wordBank;
  const eligible = Array.isArray(bank) && bank.length >= 4 && bank.length <= 8
    && bank.every(word => typeof word === 'string' && word.trim().length > 0)
    && new Set(bank.map(word => word.trim().toLowerCase())).size === bank.length;
  if (eligible) {
    const options: FillBlankOption[] = bank.map(w => ({ id: w, text: w }));
    const answerIds = value ? [String(value)] : [''];
    return (
      <div style={{ marginTop: 8 }}>
        <FillBlankPresentation
          prompt={q.prompt}
          options={options}
          answerIds={answerIds}
          onAnswerIdsChange={(answers) => onChange(answers[0] || '')}
          disabled={disabled}
        />
      </div>
    );
  }

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
        disabled={disabled}
      />
    </div>
  </div>);
}

function MatchingRenderer({ q, value, onChange, disabled }: { q: ExamQuestion; value: any; onChange: (v: any) => void; disabled?: boolean }) {
  const leftTexts: string[] = useMemo(() => {
    if (Array.isArray(q.matchingLeftTexts) && q.matchingLeftTexts.length > 0) {
      return q.matchingLeftTexts;
    }
    if (Array.isArray(q.pairs) && q.pairs.length > 0) {
      return q.pairs.map(p => p.left);
    }
    return [];
  }, [q.matchingLeftTexts, q.pairs]);

  const rightTexts: string[] = useMemo(() => {
    if (Array.isArray(q.matchingRightTexts) && q.matchingRightTexts.length > 0) {
      return q.matchingRightTexts;
    }
    if (Array.isArray(q.pairs) && q.pairs.length > 0) {
      return q.pairs.map(p => p.right);
    }
    return [];
  }, [q.matchingRightTexts, q.pairs]);

  const leftItems = useMemo(
    () => leftTexts.map((text, idx) => ({ id: idx, text })),
    [leftTexts]
  );

  const rightItems = useMemo(
    () => rightTexts.map((text, idx) => ({ id: idx, text })),
    [rightTexts]
  );

  const connections: Record<number, number> = useMemo(() => {
    if (!value || typeof value !== 'object') return {};
    const map: Record<number, number> = {};
    for (const [k, v] of Object.entries(value)) {
      const l = Number(k);
      const r = Number(v);
      if (!isNaN(l) && !isNaN(r)) {
        map[l] = r;
      }
    }
    return map;
  }, [value]);

  const handleConnectionsChange = (next: Record<string | number, string | number>) => {
    const numericMap: Record<number, number> = {};
    for (const [k, v] of Object.entries(next)) {
      numericMap[Number(k)] = Number(v);
    }
    onChange(numericMap);
  };

  return (
    <div style={{ marginTop: 8 }}>
      <MatchingInteractionCore
        leftItems={leftItems}
        rightItems={rightItems}
        connections={connections}
        onConnectionsChange={handleConnectionsChange}
        disabled={disabled}
        allowToggleDisconnect={true}
        showInstruction={!disabled}
        instructionText="Toca uno de la izquierda y luego su pareja de la derecha."
      />
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
export function formatSkillScore(rawScore: number | null | undefined): {
  isAssessed: boolean;
  score: number;
  displayScore: string;
  progressBarWidth: string;
  progressBarBg: string;
  textColor: string;
} {
  const isAssessed = typeof rawScore === 'number' && !Number.isNaN(rawScore);
  const score = isAssessed ? rawScore : 0;
  return {
    isAssessed,
    score,
    displayScore: isAssessed ? `${score}%` : 'No evaluado',
    progressBarWidth: isAssessed ? `${score}%` : '0%',
    progressBarBg: isAssessed ? (score >= 70 ? '#16a34a' : score >= 50 ? '#eab308' : '#dc2626') : 'transparent',
    textColor: isAssessed ? (score >= 70 ? '#16a34a' : score >= 50 ? '#b45309' : '#991b1b') : 'var(--text-faint, #666)',
  };
}

export function ResultsView({
  exam,
  evaluation,
  answers,
  confidences,
  questionTimes,
  resultsTab,
  setResultsTab,
  onReset,
  onBack,
  materia,
  tema,
  userName,
  duration,
  today,
  selectedPagesLabel,
}: any) {
  const score = evaluation?.score ?? 0;
  const letterGrade = computeExamLetterGrade(score);
  const perQ = evaluation?.perQuestion || [];

  // Earned & Total points
  const totalPoints = evaluation?.totalPoints ?? exam?.totalPoints ?? exam?.questions?.reduce((sum: number, q: ExamQuestion) => sum + (q.points || 10), 0) ?? 0;
  const earnedPoints = evaluation?.earnedPoints ?? (
    perQ.length > 0
      ? Math.round(exam.questions.reduce((sum: number, q: ExamQuestion, idx: number) => {
          const pq = perQ.find((p: any) => p.index === idx);
          const pts = q.points || 10;
          const fraction = pq?.partialScore !== undefined ? pq.partialScore / 100 : (pq?.correct ? 1 : 0);
          return sum + (pts * fraction);
        }, 0))
      : Math.round((score * totalPoints) / 100)
  );

  // Time calculations
  const totalTimeMs = (questionTimes || []).reduce((sum: number, t: number) => sum + (t || 0), 0);
  const formatTimeFmt = (ms: number) => {
    if (!ms || ms < 1000) return "< 1 min";
    const totalSec = Math.round(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s ? s + "s" : ""}`.trim();
  };
  const totalTimeDisplay = formatTimeFmt(totalTimeMs);
  const examTitle = materia?.nombre || materia?.name || tema?.nombre || tema?.name || exam?.title || "Examen";

  // Grade color themes
  const gradeColor = letterGrade === "A" ? "#16a34a"
    : letterGrade === "B" ? "#0284c7"
    : letterGrade === "C" ? "#d97706"
    : letterGrade === "D" ? "#ea580c"
    : "#dc2626";

  const gradeColorBg = letterGrade === "A" ? "rgba(22,163,74,.08)"
    : letterGrade === "B" ? "rgba(2,132,199,.08)"
    : letterGrade === "C" ? "rgba(217,119,6,.08)"
    : letterGrade === "D" ? "rgba(234,88,12,.08)"
    : "rgba(220,38,38,.08)";

  // Answered counts
  const totalCount = exam?.questions?.length || 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;
  exam.questions.forEach((q: ExamQuestion, i: number) => {
    const userAns = answers[i];
    const answered = isAnswered(userAns);
    const pq = perQ.find((p: any) => p.index === i);
    if (!answered) {
      unansweredCount += 1;
    } else if (pq?.correct) {
      correctCount += 1;
    } else {
      incorrectCount += 1;
    }
  });

  // Calibración: cruzar correctness x confidence (sin fabricar para preguntas sin responder)
  const calibration = useMemo(() => {
    const buckets = {
      correctSure: 0,
      correctUnsure: 0,
      wrongSure: 0,
      wrongUnsure: 0,
      skipped: 0,
    };
    exam.questions.forEach((q: ExamQuestion, i: number) => {
      const pq = perQ.find((p: any) => p.index === i);
      const conf = confidences[i];
      const userAns = answers[i];
      const answered = isAnswered(userAns);
      const correct = pq?.correct ?? false;
      if (!answered || conf === null || conf === undefined) {
        buckets.skipped += 1;
        return;
      }
      const sure = conf === "high" || conf === "very_high";
      if (correct && sure) buckets.correctSure += 1;
      else if (correct && !sure) buckets.correctUnsure += 1;
      else if (!correct && sure) buckets.wrongSure += 1;
      else if (!correct && !sure) buckets.wrongUnsure += 1;
    });
    return buckets;
  }, [exam, perQ, confidences, answers]);

  // Priority weaknesses (max 3-5, grouped & deduplicated)
  const priorityWeaknesses = useMemo<string[]>(() => {
    const list = [
      ...(evaluation?.weaknesses || []),
      ...(evaluation?.weakConcepts || []),
    ].map(String).map(s => s.trim()).filter(Boolean);
    return Array.from(new Set<string>(list)).slice(0, 4);
  }, [evaluation?.weaknesses, evaluation?.weakConcepts]);

  const strengthsList = useMemo<string[]>(() => {
    const list = (evaluation?.strengths || []).map(String).map(s => s.trim()).filter(Boolean);
    return Array.from(new Set<string>(list)).slice(0, 3);
  }, [evaluation?.strengths]);

  const computedToday = today || (exam ? new Date().toLocaleDateString('es-PA', { day: '2-digit', month: 'long', year: 'numeric' }) : '');
  const computedSelectedPagesLabel = selectedPagesLabel || (exam?.coverage ? 'Páginas autorizadas (' + exam.coverage + ')' : 'Todo el material');

  return (
    <div style={{
      maxWidth: 900,
      margin: '0 auto',
      background: '#ffffff',
      color: '#111',
      borderRadius: 6,
      padding: '48px 72px 60px',
      position: 'relative',
      fontFamily: SERIF,
      boxShadow: '0 40px 120px rgba(0,0,0,.45)',
    }}>
      {/* ═══ REUSED ACTIVE EXAM HEADER + PROFESSOR-MARKED GRADE ═══ */}
      <ExamPaperHeader
        materia={materia}
        tema={tema}
        userName={userName}
        duration={duration}
        today={computedToday}
        selectedPagesLabel={computedSelectedPagesLabel}
        grade={{
          letter: letterGrade,
          score,
          color: gradeColor,
        }}
        stats={[
          { icon: '⏱', label: 'TIEMPO TOTAL', value: totalTimeDisplay },
          { label: 'PUNTOS', value: earnedPoints + ' / ' + totalPoints },
          { label: 'RESULTADO', value: correctCount + ' / ' + totalCount + ' (' + score + '%)' },
        ]}
      />

      {/* ═══ REVIEW MODES NAVIGATION ═══ */}
      <div style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
        {[
          { id: "questions", l: "📋 Por pregunta" },
          { id: "calibration", l: "🎯 Confianza" },
          { id: "times", l: "⏱ Tiempo" },
          { id: "overview", l: "📊 Resumen" },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setResultsTab(t.id as ExamResultTab)}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: resultsTab === t.id ? "2px solid #111" : "1px solid rgba(0,0,0,.15)",
              background: resultsTab === t.id ? "#111" : "#fff",
              color: resultsTab === t.id ? "#fff" : "#111",
              fontWeight: 800,
              cursor: "pointer",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.15s ease",
            }}
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* ═══ MODE: POR PREGUNTA (DEFAULT CENTERPIECE) ═══ */}
      {resultsTab === "questions" && (
        <div style={{ display: "grid", gap: 16 }}>
          {exam.questions.map((q: ExamQuestion, i: number) => {
            const pq = perQ.find((p: any) => p.index === i);
            const userAns = answers[i];
            const answered = isAnswered(userAns);
            const isCorrect = pq?.correct ?? false;
            const partialScore = pq?.partialScore ?? (isCorrect ? 100 : 0);
            const qPoints = q.points || 10;
            const earnedQPoints = Math.round((qPoints * partialScore) / 100);
            const conf = confidences[i];
            const qTime = questionTimes?.[i] || 0;
            const sourcePages = (q.sourcePages || (q.sourcePage ? [q.sourcePage] : [])).filter((p: any) => Number.isInteger(p) && p > 0);

            // Sanitized criteria for multi-criterion if present
            const matchedCriteria = Array.isArray(evaluation?.criterionResults)
              ? evaluation.criterionResults.filter((c: any) => c.questionId === q.id)
              : [];

            // Card status styles
            const statusType = !answered ? "unanswered" : isCorrect ? "correct" : "incorrect";
            const markerBg = statusType === "correct" ? "rgba(22,163,74,.12)" : statusType === "incorrect" ? "rgba(220,38,38,.12)" : "#f3f4f6";
            const markerColor = statusType === "correct" ? "#16a34a" : statusType === "incorrect" ? "#dc2626" : "#6b7280";
            const markerSymbol = statusType === "correct" ? "✓" : statusType === "incorrect" ? "✕" : "—";
            const cardBg = statusType === "correct" ? "rgba(22,163,74,.02)" : statusType === "incorrect" ? "rgba(220,38,38,.02)" : "#fbfbfb";
            const cardBorder = statusType === "correct" ? "1.5px solid rgba(22,163,74,.22)" : statusType === "incorrect" ? "1.5px solid rgba(220,38,38,.22)" : "1.5px solid #e5e7eb";
            const statusLabel = statusType === "unanswered" ? "SIN RESPONDER" : isCorrect ? "CORRECTA" : partialScore > 0 ? `PARCIAL (${partialScore}%)` : "INCORRECTA";

            return (
              <div
                key={q.id || i}
                id={`result-question-${i}`}
                style={{
                  padding: 20,
                  borderRadius: 14,
                  background: cardBg,
                  border: cardBorder,
                  boxShadow: "0 2px 8px rgba(0,0,0,.02)",
                }}
              >
                {/* Header: Teacher Circle Marker + Prompt + Points */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1 }}>
                    {/* Circle marker styled like teacher mark */}
                    <div
                      aria-label={`${statusLabel} pregunta ${i + 1}`}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        border: `2px solid ${markerColor}`,
                        background: markerBg,
                        color: markerColor,
                        fontWeight: 950,
                        fontSize: 13,
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                        fontFamily: "'Courier New', monospace, sans-serif",
                      }}
                    >
                      {markerSymbol} {i + 1}
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.45, color: "#111" }}>
                        <AcademicContent inline content={q.prompt} />
                      </div>
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        fontSize: 11,
                        color: "#6b7280",
                        marginTop: 6,
                        fontWeight: 600,
                      }}>
                        <span style={{
                          padding: "2px 8px",
                          borderRadius: 6,
                          background: markerBg,
                          color: markerColor,
                          fontWeight: 800,
                          letterSpacing: 0.5,
                        }}>
                          {statusLabel}
                        </span>
                        <span>·</span>
                        <span>{TYPE_LABEL[q.type]}</span>
                        {answered && conf && (
                          <>
                            <span>·</span>
                            <span>{CONFIDENCE_ICON[conf as Confidence]} {CONFIDENCE_LABEL[conf as Confidence]}</span>
                          </>
                        )}
                        {qTime > 0 && (
                          <>
                            <span>·</span>
                            <span>⏱ {Math.round(qTime / 1000)}s</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{
                    fontWeight: 900,
                    fontSize: 14,
                    color: markerColor,
                    flexShrink: 0,
                    textAlign: "right",
                    padding: "4px 10px",
                    borderRadius: 8,
                    background: markerBg,
                  }}>
                    {earnedQPoints} / {qPoints} pts
                  </div>
                </div>

                {/* Answers & Correction Section */}
                {statusType === "unanswered" ? (
                  <div style={{ display: "grid", gap: 10, fontSize: 13, marginTop: 10 }}>
                    <div style={{ padding: 12, borderRadius: 8, background: "#f3f4f6", border: "1px solid #e5e7eb" }}>
                      <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: 1, marginBottom: 4, color: "#6b7280" }}>
                        TU RESPUESTA
                      </div>
                      <div style={{ color: "#9ca3af" }}>(Sin responder)</div>
                    </div>
                    <div style={{ padding: 12, borderRadius: 8, background: "rgba(22,163,74,.06)", border: "1px solid rgba(22,163,74,.15)" }}>
                      <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: 1, marginBottom: 4, color: "#16a34a" }}>
                        RESPUESTA ESPERADA
                      </div>
                      <div style={{ color: "#15803d", fontWeight: 600 }}>
                        <AcademicContent inline content={pq?.modelAnswer || formatCorrectAnswer(q)} />
                      </div>
                    </div>
                  </div>
                ) : !isCorrect ? (
                  <div style={{ display: "grid", gap: 10, fontSize: 13, marginTop: 10 }}>
                    <div style={{ padding: 12, borderRadius: 8, background: "rgba(220,38,38,.06)", border: "1px solid rgba(220,38,38,.16)" }}>
                      <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: 1, marginBottom: 4, color: "#dc2626" }}>
                        TU RESPUESTA
                      </div>
                      <div style={{ color: "#111" }}>
                        <AcademicContent inline content={formatAnswer(q, userAns)} />
                      </div>
                    </div>
                    <div style={{ padding: 12, borderRadius: 8, background: "rgba(22,163,74,.06)", border: "1px solid rgba(22,163,74,.16)" }}>
                      <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: 1, marginBottom: 4, color: "#16a34a" }}>
                        RESPUESTA ESPERADA / CORRECCIÓN
                      </div>
                      <div style={{ color: "#15803d", fontWeight: 600 }}>
                        <AcademicContent inline content={pq?.modelAnswer || formatCorrectAnswer(q)} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: pq?.modelAnswer ? "1fr 1fr" : "1fr", gap: 10, fontSize: 13, marginTop: 10 }}>
                    <div style={{ padding: 12, borderRadius: 8, background: "rgba(22,163,74,.06)", border: "1px solid rgba(22,163,74,.16)" }}>
                      <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: 1, marginBottom: 4, color: "#16a34a" }}>
                        TU RESPUESTA (CORRECTA)
                      </div>
                      <div style={{ color: "#111" }}>
                        <AcademicContent inline content={formatAnswer(q, userAns)} />
                      </div>
                    </div>
                    {pq?.modelAnswer && (
                      <div style={{ padding: 12, borderRadius: 8, background: "rgba(22,163,74,.04)", border: "1px solid rgba(22,163,74,.12)" }}>
                        <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: 1, marginBottom: 4, color: "#16a34a" }}>
                          RESPUESTA ESPERADA
                        </div>
                        <div style={{ color: "#15803d" }}>
                          <AcademicContent inline content={pq.modelAnswer} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* FEEDBACK */}
                {pq?.feedback && (
                  <div style={{
                    marginTop: 10,
                    padding: 12,
                    borderRadius: 8,
                    background: "rgba(0,0,0,.03)",
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: "#374151",
                  }}>
                    <strong style={{ fontSize: 11, letterSpacing: 0.8, color: "#6b7280", textTransform: "uppercase", display: "block", marginBottom: 2 }}>FEEDBACK</strong>
                    <AcademicContent inline content={pq.feedback} />
                  </div>
                )}

                {/* MULTI-CRITERION BREAKDOWN (Sanitized) */}
                {matchedCriteria.length > 1 && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "#fff", border: "1px solid #e5e7eb", fontSize: 12 }}>
                    <div style={{ fontWeight: 800, color: "#4b5563", marginBottom: 6 }}>DESGLOSE DE CRITERIOS:</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {matchedCriteria.map((c: any, cIdx: number) => (
                        <div key={c.criterionId || cIdx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "4px 8px", borderRadius: 4, background: "#f9fafb" }}>
                          <span style={{ color: "#374151", fontWeight: 600 }}>{c.label || `Criterio ${cIdx + 1}`}</span>
                          <span style={{ fontWeight: 800, color: (c.scorePercent ?? 0) >= 80 ? "#16a34a" : "#dc2626" }}>{c.scorePercent ?? 0}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* FUENTE GROUNDING */}
                {sourcePages.length > 0 && (
                  <div style={{
                    marginTop: 10,
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#6b7280",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}>
                    <span>📖 FUENTE:</span>
                    <span style={{ color: "#374151" }}>
                      Página{sourcePages.length > 1 ? "s" : ""} {sourcePages.join(", ")}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ MODE: CONFIANZA ═══ */}
      {resultsTab === "calibration" && (
        <div>
          <h2 style={{ fontFamily: SERIF, marginTop: 0, fontSize: 18 }}>Calibración: ¿qué tan bien te conoces?</h2>
          <p style={{ color: "#555", fontSize: 14, lineHeight: 1.6 }}>
            Cruzamos tus respuestas con tu nivel de confianza. La zona crítica es la más peligrosa: <strong>fallaste sintiéndote seguro</strong> — ahí crees que sabes pero no.
          </p>

          <div style={{ marginTop: 22, padding: 24, background: "#fff", borderRadius: 14, border: "1px solid rgba(0,0,0,.1)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr", gridTemplateRows: "40px 1fr 1fr", gap: 8 }}>
              <div></div>
              <div style={{ textAlign: "center", fontWeight: 800, fontSize: 11, letterSpacing: 1, color: "#666", textTransform: "uppercase" }}>Poco seguro</div>
              <div style={{ textAlign: "center", fontWeight: 800, fontSize: 11, letterSpacing: 1, color: "#666", textTransform: "uppercase" }}>Muy seguro</div>

              <div style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", textAlign: "center", fontWeight: 800, fontSize: 11, letterSpacing: 1, color: "#16a34a", textTransform: "uppercase" }}>Correctas</div>
              <CalCell value={calibration.correctUnsure} color="#eab308" label="Suerte / intuición" subtitle="Acertaste pero no estabas seguro" />
              <CalCell value={calibration.correctSure} color="#16a34a" label="Dominio real" subtitle="Sabes y sabes que sabes" />

              <div style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", textAlign: "center", fontWeight: 800, fontSize: 11, letterSpacing: 1, color: "#dc2626", textTransform: "uppercase" }}>Incorrectas</div>
              <CalCell value={calibration.wrongUnsure} color="#6b7280" label="Sabías que no sabías" subtitle="Honesto. Estudia con calma." />
              <CalCell value={calibration.wrongSure} color="#dc2626" label="ZONA CRÍTICA" subtitle="Creías saber pero no. Máxima prioridad." highlight />
            </div>
          </div>

          {calibration.skipped > 0 && (
            <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "#f5f5f5", fontSize: 13, color: "#666" }}>
              <strong>{calibration.skipped}</strong> preguntas saltadas / sin responder o sin confianza marcada.
            </div>
          )}
        </div>
      )}

      {/* ═══ MODE: TIEMPO ═══ */}
      {resultsTab === "times" && (
        <TimesTab
          exam={exam}
          questionTimes={questionTimes || []}
          perQ={perQ}
          answers={answers}
          onSelectQuestion={(idx: number) => {
            setResultsTab("questions");
            setTimeout(() => {
              const el = document.getElementById(`result-question-${idx}`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 50);
          }}
        />
      )}

      {/* ═══ MODE: RESUMEN ═══ */}
      {resultsTab === "overview" && (
        <div>
          {/* Concise Aggregates Grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: 12,
            marginBottom: 24,
          }}>
            <div style={{ padding: 14, borderRadius: 12, background: "#fff", border: "1px solid rgba(0,0,0,.1)", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", marginBottom: 4 }}>Calificación</div>
              <div style={{ fontSize: 22, fontWeight: 950, color: gradeColor }}>{letterGrade} ({score}%)</div>
            </div>
            <div style={{ padding: 14, borderRadius: 12, background: "#fff", border: "1px solid rgba(0,0,0,.1)", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", marginBottom: 4 }}>Puntos</div>
              <div style={{ fontSize: 22, fontWeight: 950, color: "#111" }}>{earnedPoints}/{totalPoints}</div>
            </div>
            <div style={{ padding: 14, borderRadius: 12, background: "#fff", border: "1px solid rgba(0,0,0,.1)", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#16a34a", textTransform: "uppercase", marginBottom: 4 }}>Correctas</div>
              <div style={{ fontSize: 22, fontWeight: 950, color: "#16a34a" }}>{correctCount}</div>
            </div>
            <div style={{ padding: 14, borderRadius: 12, background: "#fff", border: "1px solid rgba(0,0,0,.1)", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#dc2626", textTransform: "uppercase", marginBottom: 4 }}>Incorrectas</div>
              <div style={{ fontSize: 22, fontWeight: 950, color: "#dc2626" }}>{incorrectCount}</div>
            </div>
            <div style={{ padding: 14, borderRadius: 12, background: "#fff", border: "1px solid rgba(0,0,0,.1)", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", marginBottom: 4 }}>Sin responder</div>
              <div style={{ fontSize: 22, fontWeight: 950, color: "#4b5563" }}>{unansweredCount}</div>
            </div>
            <div style={{ padding: 14, borderRadius: 12, background: "#fff", border: "1px solid rgba(0,0,0,.1)", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", marginBottom: 4 }}>Tiempo total</div>
              <div style={{ fontSize: 22, fontWeight: 950, color: "#111" }}>{totalTimeDisplay}</div>
            </div>
          </div>

          {/* Academic Observations: at most 3-5 priority weaknesses */}
          {priorityWeaknesses.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <RBlock title="⚠️ Prioridades de refuerzo" items={priorityWeaknesses} color="#dc2626" />
            </div>
          )}

          {/* Strengths: only if present */}
          {strengthsList.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <RBlock title="✅ Fortalezas demostradas" items={strengthsList} color="#16a34a" />
            </div>
          )}

          {/* Weak Pages: only if present */}
          {evaluation?.weakPages?.length ? (
            <div style={{ marginBottom: 18, padding: 14, borderRadius: 12, background: "rgba(220,38,38,.06)", border: "1px solid rgba(220,38,38,.16)" }}>
              <strong style={{ color: "#991b1b" }}>Páginas recomendadas para lectura:</strong> {evaluation.weakPages.join(", ")}
            </div>
          ) : null}

          {/* Recommendation */}
          {evaluation?.recommendation && (
            <div style={{ padding: 14, borderRadius: 12, background: "#fff", border: "1px solid rgba(0,0,0,.1)", color: "#374151", fontSize: 14, lineHeight: 1.55 }}>
              <strong>Recomendación académica:</strong> {evaluation.recommendation}
            </div>
          )}
        </div>
      )}

      {/* ═══ REINFORCEMENT CTA CARD ═══ */}
      <div style={{
        marginTop: 28,
        padding: "24px 28px",
        borderRadius: 16,
        background: "linear-gradient(135deg, rgba(245,200,66,.12), rgba(245,200,66,.04))",
        border: "1.5px solid rgba(245,200,66,.35)",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🚀</div>
        <h3 style={{ fontFamily: SERIF, fontSize: 18, margin: "0 0 6px", color: "#111" }}>
          Sigue reforzando tu conocimiento
        </h3>
        <p style={{ margin: "0 0 18px", color: "#555", fontSize: 14, lineHeight: 1.5, maxWidth: 540, marginLeft: "auto", marginRight: "auto" }}>
          Vuelve a usar las herramientas de StudyAL para reforzar los temas que necesitas mejorar.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          {[
            { label: "📖 Repasar", action: onBack },
            { label: "🎴 Flashcards", action: onBack },
            { label: "⚡ Quiz", action: onBack },
            { label: "🗺️ Study Map", action: onBack },
          ].map((btn, idx) => (
            <button
              key={idx}
              onClick={btn.action}
              style={{
                padding: "9px 18px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,.15)",
                background: "#fff",
                color: "#111",
                fontWeight: 800,
                fontSize: 13,
                cursor: "pointer",
                boxShadow: "0 1px 3px rgba(0,0,0,.06)",
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ ACTIONS ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 24 }}>
        <button data-testid="hacer-otro-examen-btn" onClick={onReset} style={{ padding: 16, borderRadius: 12, border: "1px solid rgba(0,0,0,.14)", background: "#fff", color: "#111", fontWeight: 900, cursor: "pointer" }}>Hacer otro examen</button>
        <button onClick={onBack} style={{ padding: 16, borderRadius: 12, border: "none", background: "#111", color: "#fff", fontWeight: 900, cursor: "pointer" }}>← Volver al proceso</button>
      </div>
    </div>
  );
}

export function TimesTab({
  exam,
  questionTimes,
  perQ,
  answers,
  onSelectQuestion,
}: {
  exam: GeneratedExam;
  questionTimes: number[];
  perQ: any[];
  answers?: any[];
  onSelectQuestion?: (idx: number) => void;
}) {
  const fmt = (ms: number) => {
    if (!ms || ms < 1000) return "< 1s";
    const s = Math.round(ms / 1000);
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + "m " + (r ? r + "s" : "");
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
      <p style={{ color: "#555", fontSize: 14, lineHeight: 1.6 }}>
        Análisis de cuánto tardaste en cada pregunta. Tiempo total: <strong>{fmt(totalMs)}</strong> · Promedio: <strong>{fmt(avgMs)}</strong>
      </p>

      {(fastWrong.length > 0 || slowCorrect.length > 0) && (
        <div style={{ marginTop: 12, marginBottom: 20, padding: 14, borderRadius: 12, background: "rgba(245,200,66,.08)", border: "1px solid rgba(245,200,66,.32)" }}>
          <strong style={{ color: "#b45309", fontSize: 13 }}>📊 Patrones detectados por ALAI:</strong>
          <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 18, fontSize: 13, color: "#555", lineHeight: 1.7 }}>
            {fastWrong.length > 0 && (
              <li>Respondiste demasiado <strong>rápido</strong> e incorrectamente en las preguntas: {fastWrong.join(", ")}</li>
            )}
            {slowCorrect.length > 0 && (
              <li>Te tomó <strong>mucho tiempo</strong> acertar las preguntas: {slowCorrect.join(", ")} (concepto poco automatizado)</li>
            )}
          </ul>
        </div>
      )}

      <div style={{ display: "grid", gap: 6, marginTop: 14 }}>
        {exam.questions.map((q, i) => {
          const t = questionTimes[i] || 0;
          const pq = perQ.find((p: any) => p.index === i);
          const userAns = answers?.[i];
          const answered = isAnswered(userAns);
          const correct = pq?.correct;
          const pct = (t / max) * 100;
          const statusMarker = !answered ? "—" : correct ? "✓" : "✕";
          const statusBg = !answered ? "#9ca3af" : correct ? "#16a34a" : "#dc2626";
          const barBg = !answered
            ? "linear-gradient(90deg, #9ca3af, #6b7280)"
            : correct
            ? "linear-gradient(90deg, #16a34a, #15803d)"
            : "linear-gradient(90deg, #dc2626, #991b1b)";

          return (
            <div
              key={i}
              onClick={() => onSelectQuestion?.(i)}
              title="Click para ver la pregunta corregida"
              style={{
                display: "grid",
                gridTemplateColumns: "32px 1fr 80px 22px",
                gap: 10,
                alignItems: "center",
                padding: "4px 6px",
                borderRadius: 8,
                cursor: onSelectQuestion ? "pointer" : "default",
                transition: "background 0.1s",
              }}
            >
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: statusBg, color: "#fff", fontWeight: 900, fontSize: 11, display: "grid", placeItems: "center" }}>
                {i + 1}
              </div>
              <div style={{ position: "relative", height: 22, background: "#f0f0f0", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ width: pct + "%", height: "100%", background: barBg, opacity: .85 }} />
                <div style={{ position: "absolute", left: 8, top: 0, bottom: 0, display: "flex", alignItems: "center", fontSize: 11, color: "#fff", fontWeight: 700, mixBlendMode: "difference" }}>
                  {TYPE_LABEL[q.type as QuestionType]}
                </div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#111", textAlign: "right" }}>{fmt(t)}</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: statusBg, textAlign: "center" }}>{statusMarker}</div>
            </div>
          );
        })}
      </div>

      <h3 style={{ fontFamily: SERIF, marginTop: 28, fontSize: 16 }}>Tiempo por habilidad</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 10 }}>
        {Object.entries(skillTimes).map(([sk, data]) => (
          <div key={sk} style={{ padding: 12, borderRadius: 10, background: "#fff", border: "1px solid rgba(0,0,0,.1)" }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{SKILL_ICON[sk as Skill]} {SKILL_LABEL[sk as Skill]}</div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>{fmt(data.total / data.count)} <span style={{ fontSize: 10, color: "#999", fontWeight: 500 }}>promedio</span></div>
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
  background: 'transparent', color: 'var(--gold)',
  border: '1.5px solid var(--gold-border)',
  padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
  fontWeight: 700, fontSize: 14,
};

const cardDark: any = {
  background: 'var(--bg-card)',
  border: '1.5px solid var(--gold-border)',
  borderRadius: 18, padding: 24,
};

const lblSection: any = { fontWeight: 900, letterSpacing: 1.3, fontSize: 11, color: 'var(--text-faint)', marginBottom: 10 };
const infoBox: any = { padding: '10px 12px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 };
const errBox: any = { marginTop: 18, padding: 12, borderRadius: 10, background: 'rgba(220,38,38,.10)', border: '1px solid rgba(220,38,38,.32)', color: '#dc2626', fontWeight: 700, fontSize: 13 };

function formatAnswer(q: ExamQuestion, ans: any): string {
  if (ans === null || ans === undefined) return '(sin responder)';
  if (q.type === 'multiple_choice') return q.options?.[ans] ?? String(ans);
  if (q.type === 'true_false') return ans === true ? 'Verdadero' : ans === false ? 'Falso' : String(ans);
  if (q.type === 'matching') {
    const lefts = q.matchingLeftTexts || q.pairs?.map(p => p.left) || [];
    const rights = q.matchingRightTexts || q.pairs?.map(p => p.right) || [];
    const map = typeof ans === 'object' && ans !== null ? ans : {};
    if (lefts.length > 0) {
      return lefts.map((l, i) => `${l} → ${rights[map[i]] || '?'}`).join(' | ');
    }
    const pairs = q.pairs || [];
    return pairs.map((p, i) => `${p.left} → ${pairs[map[i]]?.right || '?'}`).join(' | ');
  }
  if (q.type === 'multi_select') {
    const selected: number[] = Array.isArray(ans) ? ans : [];
    if (!selected.length) return '(sin responder)';
    return selected.map(i => q.options?.[i] ?? String(i)).join(', ');
  }
  return String(ans);
}

function formatCorrectAnswer(q: ExamQuestion): string {
  if (q.type === 'multiple_choice') return q.options?.[q.correctAnswer] ?? '';
  if (q.type === 'true_false') return q.correctAnswer === true ? 'Verdadero' : 'Falso';
  if (q.type === 'matching') {
    const lefts = q.matchingLeftTexts || q.pairs?.map(p => p.left) || [];
    const rights = q.matchingRightTexts || q.pairs?.map(p => p.right) || [];
    if (q.matchingCorrectMap && lefts.length > 0) {
      return lefts.map((l, i) => `${l} → ${rights[q.matchingCorrectMap![i]] || '?'}`).join(' | ');
    }
    return (q.pairs || []).map(p => `${p.left} → ${p.right}`).join(' | ');
  }
  if (q.type === 'multi_select') return (q.correctAnswers || []).map(i => q.options?.[i] ?? String(i)).join(', ');
  return q.expectedAnswer || '';
}



function TopStat({ label, value }: { label: string; value: string }) {
  return (<div style={{ minWidth: 80, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.10)' }}>
    <div style={{ color: '#f5c842', fontWeight: 900, fontSize: 15 }}>{value}</div>
    <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 9, textTransform: 'uppercase', letterSpacing: .8, marginTop: 1 }}>{label}</div>
  </div>);
}

export function RBlock({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (!items || !items.length) return null;
  return (<div style={{ padding: 14, borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,.1)' }}>
    <div style={{ fontWeight: 900, color, marginBottom: 8, fontSize: 13 }}>{title}</div>
    <ul style={{ margin: 0, paddingLeft: 18, color: '#333', fontSize: 13, lineHeight: 1.6 }}>
      {items.map((x, i) => <li key={i}><AcademicContent inline content={x} /></li>)}
    </ul>
  </div>);
}
