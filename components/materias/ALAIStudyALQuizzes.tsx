'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useMasteryReporter } from '../../hooks/useMastery';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import dynamic from 'next/dynamic';
import confetti from 'canvas-confetti';
import { detectContentLanguage } from '../../lib/detectLanguage';
import MathText from '../MathText';
import MatchingCanvas from './MatchingCanvas';

const PDFViewer = dynamic(() => import('./FlashcardsPDFViewer'), { ssr: false });

// ─── Tipos ────────────────────────────────────────────────────
type QuizState = 'setup' | 'generating' | 'playing' | 'results' | 'review';
type Difficulty = 'easy' | 'medium' | 'hard';
type QuestionType =
  | 'multiple_choice'
  | 'multi_select'
  | 'true_false'
  | 'fill_blank'
  | 'matching'
  | 'short_answer';

interface Question {
  id: string;
  type: QuestionType;
  question: string;
  options?: string[];
  correctAnswer?: any;
  correctAnswers?: number[];
  explanation?: string;
  wordBank?: string[];
  pairs?: { left: string; right: string }[];
  acceptedAnswers?: string[];
  sourcePage?: number;
  sourceMaterial?: string;
  sourceMaterialName?: string;
}

interface HistoryEntry {
  question: Question;
  userAnswer: any;
  correct: boolean;
  timeMs: number;
  evaluation?: {
    nivel: string;
    porcentaje: number;
    analisis: string;
    respuestaCorrecta: string;
    explicacion: string;
    consejo?: string;
    detalles?: string[];
  };
}

const BODY = "'Plus Jakarta Sans', system-ui, sans-serif";
const HAND = BODY;

// ─── Helpers de color ─────────────────────────────────────────
const DIFF_COLOR: Record<Difficulty, string> = {
  easy: '#4ade80',
  medium: '#fbbf24',
  hard: '#f87171',
};

const DIFF_LABEL: Record<Difficulty, string> = {
  easy: 'Fácil',
  medium: 'Intermedia',
  hard: 'Difícil',
};

const TYPE_META: Record<QuestionType, { icon: string; label: string }> = {
  multiple_choice: { icon: '🔘', label: 'Opción Múltiple' },
  multi_select:    { icon: '✅', label: 'Varias Respuestas' },
  true_false:      { icon: '⚖️', label: 'Verdadero/Falso' },
  fill_blank:      { icon: '⌨️', label: 'Rellenar Palabra' },
  matching:        { icon: '🔗', label: 'Relacionar' },
  short_answer:    { icon: '📝', label: 'Respuesta Corta' },
};

// ─── Verificador de respuestas ────────────────────────────────
function normAnswer(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getExpectedAnswers(q: Question): string[] {
  const anyQ = q as any;
  if (q.acceptedAnswers?.length) return q.acceptedAnswers;
  if (anyQ.answer !== undefined) return [String(anyQ.answer)];
  if (q.correctAnswer !== undefined) return [String(q.correctAnswer)];
  return [];
}

function scoreMultiSelect(q: Question, userAnswer: any): {
  score: number;
  correct: boolean;
  detalles: string[];
} {
  const correctAnswers = new Set(q.correctAnswers || []);
  const selected = new Set(Array.isArray(userAnswer) ? userAnswer : []);

  const correctSelected = [...selected].filter(i => correctAnswers.has(i)).length;
  const wrongSelected = [...selected].filter(i => !correctAnswers.has(i)).length;
  const missed = [...correctAnswers].filter(i => !selected.has(i)).length;

  const total = Math.max(correctAnswers.size, 1);
  const raw = ((correctSelected - wrongSelected) / total) * 100;
  const score = Math.max(0, Math.round(raw));

  const label = (i: number) => `${String.fromCharCode(65 + i)}. ${q.options?.[i] ?? i}`;

  const detalles = [
    `Correctas elegidas: ${correctSelected}/${total}`,
    wrongSelected ? `Incorrectas elegidas: ${[...selected].filter(i => !correctAnswers.has(i)).map(label).join(', ')}` : '',
    missed ? `Faltaron: ${[...correctAnswers].filter(i => !selected.has(i)).map(label).join(', ')}` : '',
  ].filter(Boolean);

  return {
    score,
    correct: score >= 85,
    detalles,
  };
}

function scoreMatching(q: Question, userAnswer: any): {
  score: number;
  correct: boolean;
  detalles: string[];
} {
  const pairs = q.pairs || [];
  const answer = userAnswer && typeof userAnswer === 'object' ? userAnswer : {};
  const total = Math.max(pairs.length, 1);
  let ok = 0;

  const detalles = pairs.map((p, i) => {
    const chosenIndex = answer[i];
    const chosen = pairs[chosenIndex]?.right || 'sin conectar';
    const isOk = chosenIndex === i;
    if (isOk) ok += 1;
    return isOk
      ? `✓ ${p.left} → ${p.right}`
      : `✗ ${p.left} → ${chosen}. Correcta: ${p.right}`;
  });

  const score = Math.round((ok / total) * 100);

  return {
    score,
    correct: score === 100,
    detalles,
  };
}

function scoreWrittenLocal(q: Question, userAnswer: any): {
  score: number;
  correct: boolean;
  expected: string;
} {
  const expectedList = getExpectedAnswers(q);
  const user = normAnswer(String(userAnswer ?? ''));

  const exact = expectedList.some(e => normAnswer(e) === user);

  if (exact) {
    return {
      score: 100,
      correct: true,
      expected: expectedList[0] || '',
    };
  }

  return {
    score: 0,
    correct: false,
    expected: expectedList.join(', '),
  };
}

function checkAnswer(q: Question, userAnswer: any): boolean {
  if (q.type === 'multiple_choice') {
    return userAnswer === q.correctAnswer;
  }

  if (q.type === 'true_false') {
    const correctIsTrue =
      q.correctAnswer === true ||
      q.correctAnswer === 0 ||
      String(q.correctAnswer).toLowerCase() === 'true' ||
      String(q.correctAnswer).toLowerCase() === 'verdadero';

    const userIsTrue = userAnswer === 0 || userAnswer === true;
    return correctIsTrue === userIsTrue;
  }

  if (q.type === 'multi_select') {
    return scoreMultiSelect(q, userAnswer).correct;
  }

  if (q.type === 'fill_blank' || q.type === 'short_answer') {
    return scoreWrittenLocal(q, userAnswer).correct;
  }

  if (q.type === 'matching') {
    return scoreMatching(q, userAnswer).correct;
  }

  return false;
}

// ─── Motivacional por % ───────────────────────────────────────
function getMotivational(pct: number): { emoji: string; msg: string; color: string } {
  if (pct === 100) return { emoji: '🏆', msg: '¡Perfecto absoluto!', color: '#fbbf24' };
  if (pct >= 85)  return { emoji: '🎉', msg: '¡Excelente resultado!', color: '#4ade80' };
  if (pct >= 70)  return { emoji: '💪', msg: 'Muy buen trabajo', color: '#22d3ee' };
  if (pct >= 50)  return { emoji: '📚', msg: 'Vas por buen camino', color: '#a78bfa' };
  if (pct >= 30)  return { emoji: '🔄', msg: 'Sigue practicando', color: '#fbbf24' };
  return { emoji: '💡', msg: '¡Repasa y vuelve a intentarlo!', color: '#f87171' };
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export default function ALAIStudyALQuizzes({
  materiales,
  seleccion,
  tema,
  materia,
  onBack,
  onMasteryEvent,
  masteryContext,
}: any) {
  const themeColor = '#d6b26f'; // StudyAL gold - identidad Quiz

  // ── Setup ──────────────────────────────────────────────────
  const [quizState, setQuizState] = useState<QuizState>('setup');
  const [difficulty, setDifficulty]   = useState<Difficulty>('medium');
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>(['multiple_choice']);
  const [questionCount, setQuestionCount] = useState(10);
  const [customCount, setCustomCount]     = useState('');
  const [genError, setGenError]           = useState<string | null>(null);
  const [quizContext, setQuizContext]     = useState('');

  // ── Juego ──────────────────────────────────────────────────
  const [questions, setQuestions]   = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswer, setUserAnswer]     = useState<any>(null);
  const [isLocked, setIsLocked]         = useState(false);
  const [history, setHistory]           = useState<HistoryEntry[]>([]);
  const [quizStartTime, setQuizStartTime] = useState(0);
  const [questionStartTime, setQuestionStartTime] = useState(0);
  const [showWordBank, setShowWordBank]  = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);

  // ── PDF multi-material ────────────────────────────────────
  const [pdfUrl, setPdfUrl]         = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [numPages, setNumPages]     = useState(0);
  const [activeMaterialIndex, setActiveMaterialIndex] = useState(0);

  const activeMaterial = materiales?.[activeMaterialIndex] || null;



  // ── Timer visible ──────────────────────────────────────────
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (quizState === 'playing') {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - quizStartTime) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [quizState, quizStartTime]);

  // ── Carga de PDF — con materialId estable como dependencia ──
  const matActual = materiales?.[activeMaterialIndex] ?? materiales?.[0];
  const matActualId = matActual?.materialId || matActual?.id || null;

  useEffect(() => {
    if (!matActualId) {
      setPdfUrl(null);
      setPdfLoading(false);
      return;
    }

    let cancelled = false;
    setPdfLoading(true);
    setPdfUrl(null);

    const loadUrl = async () => {
      try {
        const res = await fetch(`/api/materials/${matActualId}/download-url`, {
          credentials: 'same-origin',
        });
        const data = await res.json();
        if (!cancelled && data?.url) {
          setPdfUrl(data.url);
        } else if (!cancelled) {
          setPdfUrl(null);
        }
      } catch (e) {
        console.error('[Quiz] Error cargando PDF:', e);
        if (!cancelled) setPdfUrl(null);
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    };

    loadUrl();
    return () => { cancelled = true; };
  // Usar el ID string como dependencia — no el objeto (que cambia en cada render)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matActualId]);

  // ── Helpers de selección (igual que ALAIStudyALCards) ──────
  const getSelectionPages = useCallback((item: any): number[] => {
    if (!item) return [];
    const candidates = [item?.pages, item?.paginasSeleccionadas, item?.selectedPages, item?.paginas, item?.pageNumbers, item?.range, item?.selection];
    for (const value of candidates) {
      if (Array.isArray(value)) {
        const arr = Array.from(new Set(value.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
        if (arr.length > 0) return arr;
      }
      if (value && typeof value === 'object') {
        const start = Number(value.start ?? value.from ?? value.startPage ?? value.paginaInicial);
        const end   = Number(value.end   ?? value.to   ?? value.endPage   ?? value.paginaFinal);
        if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start)
          return Array.from({ length: end - start + 1 }, (_, i) => start + i);
      }
    }
    return [];
  }, []);

  const getSelectionIds = useCallback((item: any): string[] => {
    const nested = item?.material || item?.documento || item?.doc || item?.source || item?.file || null;
    return [item?.materialId, item?.material_id, item?.documentId, item?.document_id, item?.docId, item?.doc_id, item?.id, nested?.materialId, nested?.material_id, nested?.id]
      .filter(Boolean).map((v: any) => String(v));
  }, []);

  const findSelectionForMaterial = useCallback((mat: any, fallbackIndex?: number): any | null => {
    if (!seleccion?.length || !mat) return null;
    const matIds = getSelectionIds(mat);
    if (typeof fallbackIndex === 'number') {
      const byMaterialIndex = seleccion.find((item: any) => Number(item?.materialIndex) === fallbackIndex) ?? undefined;
      if (byMaterialIndex) return byMaterialIndex;
      const byIndex = seleccion[fallbackIndex] ?? undefined;
      if (byIndex) {
        const byIndexIds = getSelectionIds(byIndex);
        const byIndexPages = getSelectionPages(byIndex);
        if (byIndexIds.some((id: string) => matIds.includes(id)) || byIndexPages.length > 0 || !!(byIndex as any)?.text) return byIndex;
      }
    }
    const byId = seleccion.find((item: any) => { const itemIds = getSelectionIds(item); return itemIds.some((id: string) => matIds.includes(id)); }) ?? undefined;
    if (byId) return byId;
    if (materiales.length === 1 && seleccion.length === 1) return seleccion[0] ?? null;
    return null;
  }, [seleccion, materiales, getSelectionIds, getSelectionPages]);

  // Páginas seleccionadas del material activo (para el visor)
  const activeMaterialSelectedPages = useMemo(() => {
    if (!seleccion?.length) return [];
    const sel = findSelectionForMaterial(matActual, activeMaterialIndex);
    return sel ? getSelectionPages(sel) ?? [] : [];
  }, [seleccion, matActual, activeMaterialIndex, findSelectionForMaterial, getSelectionPages]);


  const totalSelectedPages = useMemo(
    () =>
      seleccion?.length
        ? seleccion.reduce(
            (acc: number, item: any) => acc + getSelectionPages(item).length,
            0
          )
        : activeMaterialSelectedPages.length,
    [seleccion, activeMaterialSelectedPages.length, getSelectionPages]
  );


  const selectionSequence = useMemo(() => {
    const seq: { materialIndex: number; page: number }[] = [];

    for (let i = 0; i < materiales.length; i++) {
      const sel = findSelectionForMaterial(materiales[i], i);
      const pages = getSelectionPages(sel);

      for (const page of pages) {
        seq.push({ materialIndex: i, page });
      }
    }

    return seq;
  }, [materiales, findSelectionForMaterial, getSelectionPages]);

  const [globalSelectedCursor, setGlobalSelectedCursor] = useState(0);
  const globalSelectedCursorRef = useRef(0);

  useEffect(() => {
    globalSelectedCursorRef.current = globalSelectedCursor;
  }, [globalSelectedCursor]);

  useEffect(() => {
    if (!selectionSequence.length) {
      if (globalSelectedCursor !== 0) setGlobalSelectedCursor(0);
    } else {
      if (globalSelectedCursor < 0 || globalSelectedCursor >= selectionSequence.length) {
        setGlobalSelectedCursor(0);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionSequence.length]);

  useEffect(() => {
    if (!selectionSequence.length) return;
    const entry = selectionSequence[globalSelectedCursor];
    if (entry && entry.materialIndex !== activeMaterialIndex) {
      setActiveMaterialIndex(entry.materialIndex);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionSequence.length, globalSelectedCursor]);

  const currentGlobalEntry = selectionSequence[globalSelectedCursor] || null;


  const goToGlobalSelection = useCallback((nextIndex: number) => {
    if (!selectionSequence.length) return;

    const safeIndex = Math.max(
      0,
      Math.min(selectionSequence.length - 1, nextIndex)
    );

    setGlobalSelectedCursor(safeIndex);
    globalSelectedCursorRef.current = safeIndex;
  }, [selectionSequence]);

  const goToNext = useCallback(() => {
    goToGlobalSelection(globalSelectedCursorRef.current + 1);
  }, [goToGlobalSelection]);

  const goToPrev = useCallback(() => {
    goToGlobalSelection(globalSelectedCursorRef.current - 1);
  }, [goToGlobalSelection]);

  // ── Filtrar texto por páginas (igual que ALAIStudyALCards) ──
  const filterTextByPages = useCallback((fullText: string, pages: number[]): string => {
    if (!pages.length) return fullText;
    const sortedPages = [...pages].sort((a, b) => a - b);
    const lines = fullText.split('\n');
    const result: string[] = [];
    let currentPage: number | null = null;
    let capturing = false;

    for (const line of lines) {
      const pageMatch = line.match(/\[(?:Pagina|Página|Page)\s*(\d+)\]/i);
      if (pageMatch) {
        currentPage = parseInt(pageMatch[1], 10);
        capturing = sortedPages.includes(currentPage);
        if (capturing) result.push(line);
        continue;
      }
      if (line === '\f' || line.trim() === '\f') {
        if (capturing) result.push(line);
        continue;
      }
      if (capturing) result.push(line);
    }

    if (result.length === 0) {
      // Fallback: separadores \f
      const pageChunks = fullText.split('\f');
      for (const pg of sortedPages) {
        const chunk = pageChunks[pg - 1];
        if (chunk?.trim()) result.push(`[Pagina ${pg}]\n${chunk.trim()}`);
      }
    }
    return result.join('\n');
  }, []);

  // ── Extraer texto real de los materiales (igual que ALAIStudyALCards) ──
  const extractQuizText = useCallback(async (): Promise<string> => {
    const texts: string[] = [];
    for (let i = 0; i < materiales.length; i++) {
      const mat = materiales[i];
      const matId = mat?.materialId || mat?.id;
      const sel = findSelectionForMaterial(mat, i);
      const pages = getSelectionPages(sel);

      console.log('🎯 [Quiz] material', { index: i, nombre: mat?.nombre, matId, pages });

      // Texto pre-extraído en la selección
      if ((sel as any)?.text) {
        const txt = String((sel as any).text || '').trim();
        if (txt) {
          texts.push(`[Material ${i + 1}: ID=${matId} | ${mat?.nombre || matId}${pages.length ? ` | páginas ${pages.join(', ')}` : ''}]\n${txt}`);
          continue;
        }
      }

      if (!matId) { console.warn(`⚠️ [Quiz] Material ${i + 1}: sin ID`); continue; }

      

      const res = await fetch('/api/enfoques/teorico/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',  },
        body: JSON.stringify({ materialIds: [matId] }),
      });
      const data = await res.json();
      const fullText: string = data.materials?.[matId]?.text || '';

      if (!fullText) { console.warn(`⚠️ [Quiz] Material ${i + 1}: sin texto`); continue; }

      if (pages.length > 0) {
        const filtered = filterTextByPages(fullText, pages);
        if (!filtered.trim()) throw new Error('No se pudo filtrar las páginas seleccionadas. Intentá de nuevo.');
        texts.push(`[Material ${i + 1}: ID=${matId} | ${mat?.nombre || matId} | páginas ${pages.join(', ')}]\n${filtered}`);
      } else {
        texts.push(`[Material ${i + 1}: ID=${matId} | ${mat?.nombre || matId} | documento completo]\n${fullText}`);
      }
    }
    return texts.filter(Boolean).join('\n\n---\n\n');
  }, [materiales, seleccion, findSelectionForMaterial, getSelectionPages, filterTextByPages]);

  // ── Generar quiz ───────────────────────────────────────────
  const generateQuiz = useCallback(async () => {
    setQuizState('generating');
    setGenError(null);
    const finalCount = customCount
      ? Math.min(Math.max(parseInt(customCount) || 10, 1), 100)
      : questionCount;

    try {
      // Extraer texto real igual que flashcards
      const texto = await extractQuizText();
setQuizContext(
texto.slice(0,8000)
);
      if (!texto.trim()) {
        setGenError('No se pudo extraer texto del material. Verificá que el material tenga contenido.');
        setQuizState('setup');
        return;
      }
      console.log('📚 [Quiz] Texto extraído:', texto.length, 'chars');

      const res = await fetch('/api/alai-studyal-quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: texto,
          count: finalCount,
          nivel: difficulty,
          tipos: selectedTypes,
          seleccion,
          masteryContext,
        }),
      });
      const data = await res.json();
      if (data.success && data.quiz?.length > 0) {
        setQuestions(data.quiz);
        setCurrentIndex(0);
        setHistory([]);
        setUserAnswer(null);
        setIsLocked(false);
        setShowWordBank(false);
        const now = Date.now();
        setQuizStartTime(now);
        setQuestionStartTime(now);
        setElapsed(0);
        setQuizState('playing');

        // ── Modo libre: registrar uso (14%) ──
        try {
          onMasteryEvent?.({
            tool: 'quiz',
            materialId: materiales[0]?.materialId || materiales[0]?.id || '',
            score: 65,
            conceptsIdentified: data.quiz.slice(0, 8).map((q: any) => q?.primaryConcept || q?.question?.slice(0, 60) || '').filter(Boolean),
            freeModeUse: true,
            freeDomainPct: 14,
          });
        } catch (_) {}
      } else {
        setGenError(data.error || 'No se pudieron generar preguntas. Intentá con más páginas.');
        setQuizState('setup');
      }
    } catch (e: any) {
      setGenError(e?.message || 'Error de red.');
      setQuizState('setup');
    }
  }, [customCount, questionCount, difficulty, selectedTypes, seleccion, extractQuizText]);

  // ── Verificar respuesta (acepta answer directo para auto-verify) ───
  const handleVerify = useCallback(async (directAnswer?: any) => {
    const answerToCheck =
      directAnswer !== undefined
        ? directAnswer
        : userAnswer;

    if (
      isLocked ||
      isEvaluating ||
      answerToCheck === null ||
      answerToCheck === undefined
    ) return;

    const q = questions[currentIndex];
    const timeMs = Date.now() - questionStartTime;

    if (directAnswer !== undefined) {
      setUserAnswer(directAnswer);
    }

    setIsEvaluating(true);

    let correct = checkAnswer(q, answerToCheck);
    let evaluation: HistoryEntry['evaluation'] | undefined = undefined;

    if (q.type === 'multiple_choice') {
      const ok = answerToCheck === q.correctAnswer;
      const correctText = q.options?.[q.correctAnswer as number] ?? '';
      const userText = q.options?.[answerToCheck as number] ?? '';

      evaluation = {
        nivel: ok ? 'correcta' : 'incorrecta',
        porcentaje: ok ? 100 : 0,
        analisis: ok
          ? 'Elegiste la opción correcta.'
          : `Elegiste ${userText || 'una opción incorrecta'}.`,
        respuestaCorrecta: correctText,
        explicacion: q.explanation || '',
        consejo: '',
      };

      correct = ok;
    }

    if (q.type === 'true_false') {
      const ok = checkAnswer(q, answerToCheck);
      const correctIsTrue =
        q.correctAnswer === true ||
        q.correctAnswer === 0 ||
        String(q.correctAnswer).toLowerCase() === 'true' ||
        String(q.correctAnswer).toLowerCase() === 'verdadero';

      evaluation = {
        nivel: ok ? 'correcta' : 'incorrecta',
        porcentaje: ok ? 100 : 0,
        analisis: ok
          ? 'Tu elección coincide con la respuesta correcta.'
          : 'Tu elección no coincide con la respuesta correcta.',
        respuestaCorrecta: correctIsTrue ? 'Verdadero' : 'Falso',
        explicacion: q.explanation || '',
        consejo: '',
      };

      correct = ok;
    }

    if (q.type === 'multi_select') {
      const scored = scoreMultiSelect(q, answerToCheck);

      evaluation = {
        nivel: scored.score >= 85 ? 'correcta' : scored.score >= 50 ? 'medio_correcta' : 'incorrecta',
        porcentaje: scored.score,
        analisis: scored.detalles.join(' · '),
        respuestaCorrecta: (q.correctAnswers || [])
          .map(i => `${String.fromCharCode(65 + i)}. ${q.options?.[i] ?? i}`)
          .join(', '),
        explicacion: q.explanation || '',
        consejo: '',
        detalles: scored.detalles,
      };

      correct = scored.correct;
    }

    if (q.type === 'matching') {
      const scored = scoreMatching(q, answerToCheck);

      evaluation = {
        nivel: scored.score === 100 ? 'correcta' : scored.score >= 50 ? 'medio_correcta' : 'incorrecta',
        porcentaje: scored.score,
        analisis: `Relacionaste correctamente ${scored.detalles.filter(d => d.startsWith('✓')).length} de ${(q.pairs || []).length}.`,
        respuestaCorrecta: (q.pairs || []).map(p => `${p.left} → ${p.right}`).join(' | '),
        explicacion: q.explanation || 'Cada concepto debe conectarse con su pareja exacta.',
        consejo: '',
        detalles: scored.detalles,
      };

      correct = scored.correct;
    }

    if (
      q.type === 'fill_blank' ||
      q.type === 'short_answer'
    ) {
      const local = scoreWrittenLocal(q, answerToCheck);

      if (local.score === 100) {
        evaluation = {
          nivel: 'correcta',
          porcentaje: 100,
          analisis: 'Tu respuesta coincide exactamente con la respuesta esperada.',
          respuestaCorrecta: local.expected,
          explicacion: q.explanation || '',
          consejo: '',
        };

        correct = true;
      } else {
        const expected = local.expected;

        try {
          const r = await fetch(
            '/api/evaluar',
            {
              method:'POST',
              headers:{
                'Content-Type':
                'application/json'
              },
              body:JSON.stringify({
                pregunta:q.question,
                respuestaCorrecta:
                  expected,
                respuestaUsuario:
                  String(
                    answerToCheck
                  ),
                contextoMaterial:
                  quizContext,
                tipoPregunta:
                  q.type
              })
            }
          );

          const data =
            await r.json();

          if (
            data?.resultado
          ) {

            evaluation =
              data.resultado;

            correct =
              Number(
                data.resultado
                .porcentaje || 0
              ) >= 85;
          }

        } catch {
          evaluation = {
            nivel: 'incorrecta',
            porcentaje: 0,
            analisis: 'No se pudo evaluar la respuesta con IA.',
            respuestaCorrecta: expected,
            explicacion: q.explanation || '',
            consejo: '',
          };
          correct = false;
        }
      }
    }

    const entry: HistoryEntry = {
      question:q,
      userAnswer:
        answerToCheck,
      correct,
      timeMs,
      evaluation
    };

    // ── Mastery Engine: reportar resultado de Quiz ──
    try {
      const scoreVal = evaluation?.porcentaje ?? (correct ? 100 : 0);
      // Confianza calibrada: combina nivel de evaluación + velocidad de respuesta
      // Respuesta rápida + correcta = alta confianza real
      // Respuesta lenta + correcta = menor confianza (tuvo que pensar mucho)
      const baseConfMap: Record<string, number> = {
        correcta: 85, medio_correcta: 55, incorrecta: 20, dont_know: 0,
      };
      const baseConf = baseConfMap[evaluation?.nivel || ''] ?? (correct ? 80 : 20);
      // Ajuste por velocidad: respuesta < 8s suma hasta 10 puntos, > 30s resta hasta 15
      const speedBonus = timeMs < 8000 ? 10 : timeMs < 15000 ? 5 : timeMs < 30000 ? 0 : -15;
      const confVal = Math.min(100, Math.max(0, baseConf + speedBonus));
      onMasteryEvent?.({
        tool: 'quiz',
        materialId: materiales[0]?.materialId || materiales[0]?.id || '',
        score: scoreVal,
        correct,
        confidence: confVal,
        timeMs,
        // Usar primaryConcept si existe, si no usar el texto de la pregunta como fallback
        conceptName: (q as any)?.primaryConcept || q?.question?.slice(0, 60) || '',
        conceptsIdentified: (q as any)?.concepts?.length
          ? (q as any).concepts
          : [(q as any)?.primaryConcept || q?.question?.slice(0, 60) || ''].filter(Boolean),
      });
    } catch (_) {}

    const newHistory = [
      ...history,
      entry
    ];

    setHistory(
      newHistory
    );

    setIsLocked(
      true
    );

    setIsEvaluating(
      false
    );

    setTimeout(() => {
      document
        .getElementById('quiz-feedback')
        ?.scrollIntoView({
          behavior:'smooth',
          block:'center'
        });
    }, 180);

    if (
      correct &&
      currentIndex ===
      questions.length - 1
    ) {
      confetti({
        particleCount:120,
        spread:70,
        origin:{ y:0.6 }
      });
    }

  }, [
    isLocked,
    isEvaluating,
    userAnswer,
    questions,
    currentIndex,
    history,
    questionStartTime
  ]);

// ── Siguiente pregunta ─────────────────────────────────────
  const handleNext = useCallback(() => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(i => i + 1);
      setUserAnswer(null);
      setIsLocked(false);
      setShowWordBank(false);
      setQuestionStartTime(Date.now());
    } else {
      setQuizState('results');
    }
  }, [currentIndex, questions.length]);

  // ── Stats finales ──────────────────────────────────────────
  const stats = useMemo(() => {
    const correct   = history.filter(h => h.correct).length;
    const incorrect = history.length - correct;
    const pct       = Math.round((correct / Math.max(history.length, 1)) * 100);
    const totalTime = Math.floor((Date.now() - quizStartTime) / 1000);
    const avgTime   = history.length
      ? Math.round(history.reduce((a, b) => a + b.timeMs, 0) / history.length / 1000)
      : 0;
    return { correct, incorrect, pct, totalTime, avgTime };
  }, [history, quizStartTime]);

  // ── Reiniciar ──────────────────────────────────────────────
  const handleRestart = useCallback(() => {
    setQuizState('setup');
    setQuestions([]);
    setHistory([]);
    setCurrentIndex(0);
    setUserAnswer(null);
    setIsLocked(false);
  }, []);

  const handleRetryWrong = useCallback(() => {
    const wrong = history.filter(h => !h.correct).map(h => h.question);
    if (!wrong.length) return;
    setQuestions(wrong);
    setCurrentIndex(0);
    setHistory([]);
    setUserAnswer(null);
    setIsLocked(false);
    setShowWordBank(false);
    const now = Date.now();
    setQuizStartTime(now);
    setQuestionStartTime(now);
    setElapsed(0);
    setQuizState('playing');
  }, [history]);

  // ── Live stats durante el juego ────────────────────────────
  const liveCorrect   = history.filter(h => h.correct).length;
  const liveIncorrect = history.filter(h => !h.correct).length;
  const currentQ      = questions[currentIndex];


  useEffect(() => {
    if (!currentQ) return;

    const matIndex = materiales.findIndex((m: any) =>
      (m.materialId || m.id) === currentQ.sourceMaterial ||
      (m.nombre || m.name) === currentQ.sourceMaterialName
    );

    const targetMaterialIndex = matIndex >= 0 ? matIndex : activeMaterialIndex;
    const targetPage = Number(currentQ.sourcePage || 0);

    if (matIndex >= 0 && matIndex !== activeMaterialIndex) {
      setActiveMaterialIndex(matIndex);
    }

    if (targetPage > 0 && selectionSequence.length > 0) {
      const targetGlobalIndex = selectionSequence.findIndex(
        (entry) =>
          entry.materialIndex === targetMaterialIndex &&
          entry.page === targetPage
      );

      if (
        targetGlobalIndex >= 0 &&
        targetGlobalIndex !== globalSelectedCursorRef.current
      ) {
        setGlobalSelectedCursor(targetGlobalIndex);
        globalSelectedCursorRef.current = targetGlobalIndex;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);



  // Cuando la pregunta cambia de material, cambiar el PDF activo
  useEffect(() => {
    if (!currentQ?.sourceMaterial) return;
    const matIndex = materiales.findIndex((m: any) =>
      (m.materialId || m.id) === currentQ.sourceMaterial
    );
    if (matIndex >= 0 && matIndex !== activeMaterialIndex) {
      setActiveMaterialIndex(matIndex);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQ?.sourceMaterial]);

  const quizPdfSelectedPages = useMemo(() => {
    const base = Array.isArray(activeMaterialSelectedPages)
      ? activeMaterialSelectedPages
      : [];

    const srcPage = Number(currentQ?.sourcePage || 0);

    return Array.from(
      new Set([
        ...base.map(Number).filter(n => Number.isFinite(n) && n > 0),
        ...(srcPage > 0 ? [srcPage] : []),
      ])
    ).sort((a, b) => a - b);
  }, [activeMaterialSelectedPages, currentQ?.sourcePage]);

  const isLastQ       = currentIndex === questions.length - 1;
  const mot           = getMotivational(stats.pct);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // ──────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────
  return (
    <div className="saq-screen">
      <div className="saq-bg-radial" />
      <div className="saq-bg-grid" />
      {/* ── HEADER ─────────────────────────────────────────── */}
      <header className="saq-topbar">
        <button className="saq-back" onClick={onBack}>
          ← volver al proceso
        </button>

        <div className="saq-hero">
          <div className="saq-chip">04 · Aplicar</div>
          <h1>
            <span className="saq-emoji">🎯</span>
            The Study<span style={{color:'#ef4444'}}>AL</span> Quizzes
            <small>{tema?.nombre}</small>
          </h1>
        </div>

        {/* Timeline central (solo playing) */}
        {quizState === 'playing' && questions.length > 0 && (
          <div className="saq-timeline-wrap">
            <div className="saq-timeline-title">
              Pregunta <b>{currentIndex + 1} de {questions.length}</b>
            </div>
            <div className="saq-timeline">
              <div className="saq-timeline-line" />
              <div
                className="saq-timeline-line-fill"
                style={{ width: `${(currentIndex / Math.max(questions.length - 1, 1)) * 100}%` }}
              />
              {questions.map((_, i) => {
                const done = i < currentIndex;
                const active = i === currentIndex;
                const correct = history[i]?.correct;
                return (
                  <div
                    key={i}
                    className={`saq-tl-node ${active ? 'active' : ''} ${done ? (correct ? 'done-correct' : 'done-wrong') : ''}`}
                  >
                    {done ? (correct ? '✓' : '✗') : (i + 1)}
                  </div>
                );
              })}
            </div>
            {currentIndex > 0 && history[currentIndex - 1]?.correct && (
              <div className="saq-timeline-cheer">¡Vamos bien!</div>
            )}
          </div>
        )}

        {/* Reportar error (derecha) */}
        {quizState === 'playing' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="saq-report-btn" title="Reportar error en la pregunta">
              ⚡ Reportar error
            </button>
            <button className="saq-menu-btn" title="Más opciones">⋮</button>
          </div>
        )}
      </header>

      {/* ── BODY ───────────────────────────────────────────── */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Fondo de puntos */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(circle, rgba(255,255,255,0.025) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            pointerEvents: 'none',
          }}
        />

        {/* PDF lado izquierdo en card StudyAL */}
        {quizState === 'playing' && (
          <div className="saq-pdf-panel">
            <div className="saq-pdf-card">
              <div className="saq-pdf-head">
                <div className="saq-pdf-head-icon">📄</div>
                <div className="saq-pdf-head-info">
                  <strong>{matActual?.nombre || matActual?.name || 'Material'}</strong>
                  <span>{activeMaterialSelectedPages.length ? `${activeMaterialSelectedPages.length} páginas` : 'documento'}</span>
                </div>
                <button className="saq-pdf-bookmark" title="Marcar página">🔖</button>
              </div>
              <div className="saq-pdf-body">
            {pdfLoading ? (
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                color: '#555',
              }}>
                <div style={{
                  width: 32,
                  height: 32,
                  border: `3px solid ${themeColor}33`,
                  borderTop: `3px solid ${themeColor}`,
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }} />
                <div style={{ fontSize: 14, fontFamily: BODY, fontStyle: 'italic' }}>
                  Cargando PDF...
                </div>
              </div>
            ) : pdfUrl ? (
              <PDFViewer
                key={`${activeMaterialIndex}-${matActual?.materialId || matActual?.id || 'material'}-${pdfUrl || ''}`}
                url={pdfUrl}
                selectedPages={quizPdfSelectedPages}
                themeColor={themeColor}
                onTotalPages={setNumPages}
                totalSelectedPages={totalSelectedPages}
                activeMaterialIndex={activeMaterialIndex}
                materialesCount={materiales.length}
                forcedPage={currentQ?.sourcePage || currentGlobalEntry?.page || undefined}
                globalSelectedIndex={selectionSequence.length > 0 ? globalSelectedCursor : undefined}
                globalSelectedTotal={selectionSequence.length > 0 ? totalSelectedPages : undefined}
                onRequestPrev={selectionSequence.length > 0 ? goToPrev : undefined}
                onRequestNext={selectionSequence.length > 0 ? goToNext : undefined}
                currentQuestionPage={Number(currentQ?.sourcePage) || undefined}
                scrollTrigger={currentIndex}
              />
            ) : (
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                color: '#555',
              }}>
                <div style={{ fontSize: 36 }}>📄</div>
                <div style={{ fontSize: 14, fontFamily: BODY, fontStyle: 'italic' }}>
                  No se pudo cargar el material
                </div>
              </div>
            )}
              </div>
            </div>
          </div>
        )}

{/* Panel derecho */}
        <div
          className={quizState === 'playing' ? 'saq-playing-area' : ''}
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: quizState === 'playing' ? '12px 16px 24px' : '20px 24px 40px',
            position: 'relative',
            zIndex: 2,
            gap: 14,
          }}
        >
          <AnimatePresence mode="wait">
            {/* ════ 1. SETUP ════ */}
            {quizState === 'setup' && (
              <SetupScreen
                key="setup"
                themeColor={themeColor}
                difficulty={difficulty}
                setDifficulty={setDifficulty}
                selectedTypes={selectedTypes}
                setSelectedTypes={setSelectedTypes}
                questionCount={questionCount}
                setQuestionCount={setQuestionCount}
                customCount={customCount}
                setCustomCount={setCustomCount}
                genError={genError}
                onGenerate={generateQuiz}
              />
            )}

            {/* ════ 2. GENERATING ════ */}
            {quizState === 'generating' && (
              <motion.div
                key="gen"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                style={{
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 24,
                  paddingTop: 80,
                }}
              >
                <div
                  style={{
                    width: 72,
                    height: 72,
                    border: `4px solid ${themeColor}22`,
                    borderTopColor: themeColor,
                    borderRadius: '50%',
                    animation: 'spin 0.9s linear infinite',
                  }}
                />
                <div style={{ fontFamily: HAND, fontSize: 34, color: '#fff' }}>
                  La IA está diseñando tu examen...
                </div>
                <div style={{ fontSize: 14, color: '#555' }}>
                  Analizando las páginas seleccionadas
                </div>
              </motion.div>
            )}

            {/* ════ 3. PLAYING ════ */}
            {quizState === 'playing' && currentQ && (
              <div key={`play-${currentIndex}`} className="saq-playing-grid">
                <div className="saq-playing-center">
                  <QuestionCard
                    key={`q-${currentIndex}`}
                    question={currentQ}
                    index={currentIndex}
                    total={questions.length}
                    themeColor={themeColor}
                    userAnswer={userAnswer}
                    setUserAnswer={setUserAnswer}
                    isLocked={isLocked}
                    lastEntry={history[history.length - 1] ?? null}
                    showWordBank={showWordBank}
                    setShowWordBank={setShowWordBank}
                    onVerify={handleVerify}
                    isEvaluating={isEvaluating}
                    onNext={handleNext}
                    isLast={isLastQ}
                  />
                </div>
                <aside className="saq-playing-side">
                  {/* Tiempo + racha */}
                  <div className="saq-side-card">
                    <div className="saq-side-row">
                      <span className="saq-side-icon" style={{ color: 'var(--gold)' }}>⏱</span>
                      <div className="saq-side-text">
                        <small>Tiempo</small>
                        <strong>{formatTime(elapsed)}</strong>
                      </div>
                    </div>
                    <div className="saq-side-divider" />
                    <div className="saq-side-row">
                      <span className="saq-side-icon" style={{ color: '#ef4444' }}>🔥</span>
                      <div className="saq-side-text">
                        <small>Racha</small>
                        <strong style={{ fontSize: 14 }}>
                          {(() => {
                            let streak = 0;
                            for (let i = history.length - 1; i >= 0; i--) {
                              if (history[i].correct) streak++;
                              else break;
                            }
                            return streak;
                          })()} consecutivas
                        </strong>
                      </div>
                    </div>
                    <div className="saq-side-divider" />
                    <div className="saq-side-stats">
                      <span><i style={{ background: '#22c55e' }}/>{liveCorrect}</span>
                      <span><i style={{ background: '#ef4444' }}/>{liveIncorrect}</span>
                    </div>
                  </div>

                  {/* Tip ALAI */}
                  <div className="saq-tip-sticker">
                    <h5>✦ Tip ALAI</h5>
                    <p>
                      Lee la pregunta dos veces antes de elegir. ALAI prefiere precisión a velocidad.
                    </p>
                  </div>

                  {/* Herramientas con atajos */}
                  <div className="saq-side-card">
                    <h4 className="saq-side-h4">Herramientas</h4>
                    <button className="saq-tool-btn" disabled>
                      💡 <span>Pista</span> <kbd>P</kbd>
                    </button>
                    <button className="saq-tool-btn" disabled>
                      ✂ <span>Eliminar 2 opciones</span> <kbd>E</kbd>
                    </button>
                    <button className="saq-tool-btn" disabled>
                      📚 <span>Repasar este tema</span> <kbd>R</kbd>
                    </button>
                  </div>
                </aside>
              </div>
            )}

            {/* ════ 4. RESULTS ════ */}
            {quizState === 'results' && (
              <ResultsScreen
                key="results"
                stats={stats}
                history={history}
                mot={mot}
                difficulty={difficulty}
                selectedTypes={selectedTypes}
                themeColor={themeColor}
                onRestart={handleRestart}
                onRetryWrong={handleRetryWrong}
                onReview={() => setQuizState('review')}
                formatTime={formatTime}
              />
            )}

            {/* ════ 5. REVIEW ════ */}
            {quizState === 'review' && (
              <ReviewScreen
                key="review"
                history={history}
                themeColor={themeColor}
                onBack={() => setQuizState('results')}
              />
            )}
          </AnimatePresence>
        </div>
      </main>

      <style>{SAQ_STYLES}</style>
    </div>
  );
}

const SAQ_STYLES = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes saqFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  .saq-screen {
    position: fixed;
    inset: 0;
    background: var(--bg-primary);
    color: var(--text-primary);
    z-index: 9999;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .saq-bg-radial {
    position: absolute; inset: 0; pointer-events: none;
    background:
      radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--gold) 6%, transparent), transparent 55%),
      radial-gradient(circle at 85% 80%, color-mix(in srgb, #ef4444 4%, transparent), transparent 50%),
      radial-gradient(circle at 15% 75%, color-mix(in srgb, var(--blue) 3%, transparent), transparent 50%);
  }
  .saq-bg-grid {
    position: absolute; inset: 0; pointer-events: none;
    opacity: .06;
    background-image:
      linear-gradient(to right, color-mix(in srgb, var(--text-primary) 18%, transparent) 1px, transparent 1px),
      linear-gradient(to bottom, color-mix(in srgb, var(--text-primary) 18%, transparent) 1px, transparent 1px);
    background-size: 40px 40px;
  }

  .saq-topbar {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 14px 24px;
    border-bottom: 1px solid var(--border-color2);
    background: linear-gradient(to bottom, var(--bg-primary) 80%, transparent);
    flex-shrink: 0;
  }
  .saq-back {
    border: 2px solid var(--text-primary);
    background: var(--bg-card);
    color: var(--text-primary);
    border-radius: 14px;
    padding: 9px 16px;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 3px 4px 0 var(--text-primary);
    transition: transform .2s ease, box-shadow .2s ease;
    white-space: nowrap;
  }
  .saq-back:hover {
    transform: translate(-2px, -2px);
    box-shadow: 5px 6px 0 var(--text-primary);
  }
  .saq-hero { min-width: 0; flex: 1; }
  .saq-chip {
    display: inline-block;
    font-size: 10px; font-weight: 900;
    letter-spacing: 0.4px;
    padding: 3px 8px;
    background: color-mix(in srgb, #ef4444 18%, transparent);
    color: #ef4444;
    border: 1px solid color-mix(in srgb, #ef4444 35%, transparent);
    border-radius: 4px;
    margin-bottom: 4px;
  }
  .saq-hero h1 {
    margin: 0;
    display: flex; align-items: center; gap: 10px;
    font-size: 22px; font-weight: 900; line-height: 1;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }
  .saq-emoji {
    font-size: 24px;
    filter: drop-shadow(0 0 8px color-mix(in srgb, #ef4444 50%, transparent));
  }
  .saq-hero h1 small {
    font-size: 13px; font-weight: 700; color: var(--text-faint);
    letter-spacing: 0;
  }

  /* ===== SETUP DASHBOARD ===== */
  .saq-setup {
    display: grid;
    grid-template-columns: 220px 1fr 230px;
    gap: 18px;
    width: 100%;
    max-width: 1400px;
    margin: 0 auto;
    padding: 4px 4px 40px;
    animation: saqFadeIn .5s ease;
  }
  .saq-setup-center {
    display: flex; flex-direction: column; gap: 18px;
  }
  .saq-setup-title {
    text-align: center;
    margin-bottom: 4px;
  }
  .saq-setup-title h2 {
    margin: 0;
    font-size: 32px; font-weight: 900;
    letter-spacing: -0.8px;
    color: var(--text-primary);
  }
  .saq-setup-title h2 b {
    color: var(--gold); font-weight: 900;
  }
  .saq-setup-title p {
    margin: 6px 0 0;
    color: var(--text-faint); font-size: 13px;
  }

  /* Cards laterales (mismo estilo StudyALProcess) */
  .saq-card {
    background: var(--bg-card);
    border: 1.5px solid var(--border-color2);
    border-radius: 14px;
    padding: 14px;
    box-shadow: 0 8px 24px rgba(0,0,0,.25);
  }
  .saq-card h4 {
    margin: 0 0 10px;
    font-size: 12.5px; font-weight: 800;
    color: var(--text-secondary);
    letter-spacing: .2px;
    display: flex; align-items: center; gap: 6px;
  }
  .saq-card-row {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 0;
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .saq-card-row b {
    margin-left: auto;
    color: var(--text-primary);
    font-weight: 900;
  }
  .saq-card-row i {
    width: 8px; height: 8px; border-radius: 50%;
    display: inline-block;
  }

  /* Tip card dorada */
  .saq-tip {
    background: color-mix(in srgb, var(--gold) 8%, transparent);
    border: 1.5px dashed var(--gold-border);
    border-radius: 14px;
    padding: 12px;
    display: flex; gap: 10px; align-items: flex-start;
  }
  .saq-tip span { font-size: 16px; }
  .saq-tip p {
    margin: 0; font-size: 11.5px; line-height: 1.45;
    color: var(--text-muted);
  }
  .saq-tip p b { color: var(--gold); font-weight: 900; }

  /* ===== CENTRO ===== */
  .saq-section-label {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; font-weight: 900;
    color: var(--text-secondary);
    margin-bottom: 10px;
  }
  .saq-section-label b {
    color: var(--gold);
    font-size: 16px;
  }

  /* Grid tipos de preguntas */
  .saq-types-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .saq-type-card {
    background: var(--bg-card);
    border: 2px solid var(--border-color2);
    border-radius: 12px;
    padding: 14px 12px;
    cursor: pointer;
    text-align: left;
    transition: all .2s ease;
    position: relative;
    color: var(--text-primary);
    display: flex; flex-direction: column; gap: 8px;
  }
  .saq-type-card:hover {
    transform: translateY(-2px);
    border-color: var(--gold-border);
    box-shadow: 0 8px 20px rgba(0,0,0,.3);
  }
  .saq-type-card.active {
    border-color: var(--gold);
    background: color-mix(in srgb, var(--gold) 10%, var(--bg-card));
    box-shadow: 0 0 0 1px var(--gold), 0 8px 24px color-mix(in srgb, var(--gold) 20%, transparent);
  }
  .saq-type-check {
    position: absolute;
    top: 10px; right: 10px;
    width: 22px; height: 22px;
    border-radius: 6px;
    border: 2px solid var(--border-color2);
    display: grid; place-items: center;
    background: var(--bg-secondary);
    transition: all .2s ease;
    font-size: 11px; font-weight: 900;
    color: transparent;
  }
  .saq-type-card.active .saq-type-check {
    background: var(--gold);
    border-color: var(--gold);
    color: #0a0a0a;
  }
  .saq-type-icon {
    font-size: 22px;
  }
  .saq-type-title {
    font-size: 13.5px; font-weight: 900;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .saq-type-desc {
    font-size: 11px;
    color: var(--text-faint);
    line-height: 1.35;
  }

  /* Cantidad + dificultad row */
  .saq-row-2 {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 14px;
  }
  .saq-count-pills {
    display: flex; gap: 6px; flex-wrap: wrap;
  }
  .saq-count-pill {
    width: 44px; height: 40px;
    border-radius: 10px;
    border: 1.5px solid var(--border-color2);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 14px; font-weight: 900;
    cursor: pointer;
    transition: all .2s ease;
  }
  .saq-count-pill:hover {
    border-color: var(--gold-border);
    color: var(--gold);
  }
  .saq-count-pill.active {
    background: var(--gold);
    color: #0a0a0a;
    border-color: var(--gold);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--gold) 30%, transparent);
  }
  .saq-count-input {
    flex: 1; min-width: 120px;
    background: var(--bg-card2);
    border: 1.5px solid var(--border-color2);
    border-radius: 10px;
    padding: 10px 14px;
    color: var(--text-primary);
    font-size: 13px;
    outline: none;
  }
  .saq-count-input:focus { border-color: var(--gold); }

  .saq-diff-pills {
    display: flex; gap: 6px;
  }
  .saq-diff-pill {
    flex: 1;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1.5px solid var(--border-color2);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 13px; font-weight: 800;
    cursor: pointer;
    transition: all .2s ease;
  }
  .saq-diff-pill:hover {
    border-color: var(--gold-border);
  }
  .saq-diff-pill.active {
    background: var(--gold);
    color: #0a0a0a;
    border-color: var(--gold);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--gold) 30%, transparent);
  }

  .saq-meta-box {
    background: var(--bg-card);
    border: 1.5px dashed var(--border-color2);
    border-radius: 12px;
    padding: 10px 14px;
    font-size: 12px;
    color: var(--text-muted);
    display: flex; align-items: center; gap: 8px;
  }
  .saq-meta-box b {
    color: var(--gold); font-weight: 900;
  }

  /* CTA generar */
  .saq-generate-btn {
    width: 100%;
    padding: 16px;
    border-radius: 14px;
    border: 2px solid var(--gold);
    background: var(--gold);
    color: #0a0a0a;
    font-weight: 900;
    font-size: 16px;
    cursor: pointer;
    box-shadow: 4px 5px 0 color-mix(in srgb, var(--gold) 50%, #000);
    transition: transform .2s ease, box-shadow .2s ease;
    letter-spacing: 0.3px;
    display: flex; align-items: center; justify-content: center; gap: 10px;
  }
  .saq-generate-btn:hover {
    transform: translate(-2px, -2px);
    box-shadow: 6px 7px 0 color-mix(in srgb, var(--gold) 50%, #000);
  }
  .saq-generate-btn:disabled {
    background: var(--bg-card2);
    color: var(--text-faint);
    border-color: var(--border-color2);
    box-shadow: none;
    cursor: not-allowed;
  }

  .saq-error {
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(248,113,113,0.1);
    border: 1px solid rgba(248,113,113,0.4);
    color: #fca5a5;
    font-size: 13px;
    font-weight: 700;
  }

  /* ===== RESPONSIVE ===== */
  @media (max-width: 1100px) {
    .saq-setup { grid-template-columns: 1fr; }
    .saq-types-grid { grid-template-columns: repeat(2, 1fr); }
  }
  /* ═══════════════════════════════════════════════════════════
     PLAYING SCREEN — Quiz en acción tipo cuaderno
     ═══════════════════════════════════════════════════════════ */

  /* Cuando estamos en playing, ocultar el hero grande del topbar */
  .saq-screen:has(.saq-timeline-wrap) .saq-hero { display: none; }

  .saq-timeline-wrap {
    flex: 1;
    min-width: 0;
    text-align: center;
  }
  .saq-timeline-title {
    font-size: 13px;
    color: var(--text-faint);
    margin-bottom: 6px;
    font-weight: 700;
  }
  .saq-timeline-title b {
    color: var(--gold);
    font-weight: 900;
    font-size: 14px;
  }
  .saq-timeline {
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
    max-width: 720px;
    margin: 0 auto;
    padding: 0 4px;
  }
  .saq-timeline-line {
    position: absolute;
    left: 12px; right: 12px;
    top: 50%;
    height: 2px;
    background: var(--border-color2);
    transform: translateY(-50%);
    z-index: 0;
  }
  .saq-timeline-line-fill {
    position: absolute;
    left: 12px;
    top: 50%;
    height: 2px;
    background: var(--gold);
    transform: translateY(-50%);
    z-index: 1;
    transition: width .4s ease;
    box-shadow: 0 0 6px var(--gold);
  }
  .saq-tl-node {
    position: relative;
    z-index: 2;
    width: 22px; height: 22px;
    border-radius: 50%;
    background: var(--bg-card);
    border: 1.5px solid var(--border-color2);
    display: grid;
    place-items: center;
    font-size: 10px;
    font-weight: 900;
    color: var(--text-faint);
    transition: all .25s ease;
  }
  .saq-tl-node.done-correct {
    background: #22c55e;
    border-color: #22c55e;
    color: #000;
    box-shadow: 0 0 8px #22c55e88;
  }
  .saq-tl-node.done-wrong {
    background: #ef4444;
    border-color: #ef4444;
    color: #fff;
    box-shadow: 0 0 8px #ef444488;
  }
  .saq-tl-node.active {
    width: 28px; height: 28px;
    background: var(--gold);
    border-color: var(--gold);
    color: #0a0a0a;
    font-size: 12px;
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--gold) 25%, transparent), 0 0 12px var(--gold);
    animation: saqPulse 1.4s ease infinite;
  }
  @keyframes saqPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }
  .saq-timeline-cheer {
    margin-top: 6px;
    font-size: 11.5px;
    font-weight: 800;
    color: var(--gold);
    letter-spacing: 0.3px;
  }

  .saq-report-btn {
    border: 1.5px solid var(--border-color2);
    background: var(--bg-card);
    color: var(--text-muted);
    border-radius: 10px;
    padding: 7px 12px;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
    transition: all .2s ease;
  }
  .saq-report-btn:hover {
    color: var(--gold);
    border-color: var(--gold);
  }
  .saq-menu-btn {
    width: 32px; height: 32px;
    border-radius: 8px;
    background: var(--bg-card);
    border: 1.5px solid var(--border-color2);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
  }

  /* ─── PDF Panel ─── */
  .saq-pdf-panel {
    flex: 0 0 40%;
    max-width: 520px;
    min-width: 340px;
    padding: 12px 0 12px 16px;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .saq-pdf-card {
    flex: 1;
    min-height: 0;
    background: var(--bg-card);
    border: 1.5px solid var(--border-color2);
    border-radius: 14px;
    box-shadow: 0 8px 24px rgba(0,0,0,.25);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .saq-pdf-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-color2);
    flex-shrink: 0;
  }
  .saq-pdf-head-icon {
    font-size: 16px;
    width: 32px; height: 32px;
    display: grid; place-items: center;
    background: var(--bg-secondary);
    border: 1.5px solid var(--border-color);
    border-radius: 8px;
  }
  .saq-pdf-head-info { flex: 1; min-width: 0; }
  .saq-pdf-head-info strong {
    display: block;
    font-size: 12.5px;
    font-weight: 900;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .saq-pdf-head-info span {
    display: block;
    font-size: 10px;
    color: var(--text-faint);
    font-weight: 700;
  }
  .saq-pdf-bookmark {
    width: 28px; height: 28px;
    border-radius: 7px;
    background: var(--bg-secondary);
    border: 1.5px solid var(--border-color2);
    color: var(--gold);
    cursor: pointer;
    font-size: 13px;
  }
  .saq-pdf-tabs {
    display: flex;
    gap: 4px;
    padding: 8px 10px 0;
    flex-shrink: 0;
  }
  .saq-pdf-tab {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text-faint);
    padding: 6px 4px;
    font-size: 11px;
    font-weight: 800;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all .2s ease;
  }
  .saq-pdf-tab:hover { color: var(--text-secondary); }
  .saq-pdf-tab.active {
    color: var(--gold);
    border-bottom-color: var(--gold);
  }
  .saq-pdf-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* ─── Playing area layout ─── */
  .saq-playing-area {
    align-items: stretch !important;
  }
  .saq-playing-grid {
    display: grid;
    grid-template-columns: 1fr 200px;
    gap: 14px;
    width: 100%;
    max-width: 980px;
    margin: 0 auto;
    align-items: start;
  }
  .saq-playing-center { min-width: 0; }
  .saq-playing-side {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* ─── Side cards ─── */
  .saq-side-card {
    background: var(--bg-card);
    border: 1.5px solid var(--border-color2);
    border-radius: 14px;
    padding: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,.25);
  }
  .saq-side-h4 {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 900;
    color: var(--gold);
    letter-spacing: 0.3px;
  }
  .saq-side-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .saq-side-icon { font-size: 18px; }
  .saq-side-text { flex: 1; min-width: 0; }
  .saq-side-text small {
    display: block;
    font-size: 10px;
    font-weight: 800;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .saq-side-text strong {
    display: block;
    font-size: 22px;
    font-weight: 900;
    color: var(--text-primary);
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .saq-side-divider {
    height: 1px;
    background: var(--border-color2);
    margin: 10px 0;
  }
  .saq-side-stats {
    display: flex;
    gap: 12px;
    font-size: 13px;
    font-weight: 900;
    color: var(--text-secondary);
  }
  .saq-side-stats span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .saq-side-stats i {
    width: 8px; height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  /* Sticker Tip ALAI */
  .saq-tip-sticker {
    background: color-mix(in srgb, var(--gold) 18%, #f5ecd6);
    color: #2a1a05;
    padding: 12px 12px 10px;
    border-radius: 4px;
    box-shadow: 0 6px 14px rgba(0,0,0,.4);
    transform: rotate(-1deg);
    position: relative;
  }
  .saq-tip-sticker::before {
    content: '';
    position: absolute;
    top: -8px; left: 50%;
    width: 50px; height: 14px;
    transform: translateX(-50%) rotate(-3deg);
    background: color-mix(in srgb, var(--red) 55%, #c8a05a);
    opacity: 0.8;
  }
  .saq-tip-sticker h5 {
    margin: 0 0 4px;
    font-size: 12.5px;
    font-weight: 900;
    color: #2a1a05;
  }
  .saq-tip-sticker p {
    margin: 0;
    font-size: 11px;
    line-height: 1.4;
    color: #3a2a10;
  }

  /* Tool buttons con kbd */
  .saq-tool-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    margin-bottom: 4px;
    background: transparent;
    border: 1px solid var(--border-color2);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all .2s ease;
    text-align: left;
  }
  .saq-tool-btn:hover:not(:disabled) {
    border-color: var(--gold);
    color: var(--gold);
  }
  .saq-tool-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .saq-tool-btn span { flex: 1; }
  .saq-tool-btn kbd {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color2);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 10px;
    font-family: ui-monospace, monospace;
    color: var(--text-muted);
    font-weight: 800;
  }

  /* ═══════════════════════════════════════════════════════════
     QUESTION CARD - Hoja cuaderno StudyAL
     ═══════════════════════════════════════════════════════════ */
  .saq-qcard-wrap {
    width: 100%;
    max-width: 660px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0 auto;
  }
  .saq-paper {
    position: relative;
    background:
      repeating-linear-gradient(to bottom, #f5ecd6 0 32px, #ecd9b3 32px 33px);
    color: #1a1a1a;
    border: 2px solid rgba(0,0,0,.3);
    border-radius: 8px;
    padding: 24px 28px 24px 56px;
    box-shadow: 0 18px 50px rgba(0,0,0,.55), 6px 8px 0 rgba(0,0,0,.35);
  }
  .saq-paper-spiral {
    position: absolute;
    left: 14px;
    top: 16px;
    bottom: 16px;
    width: 12px;
    display: flex;
    flex-direction: column;
    justify-content: space-around;
  }
  .saq-paper-spiral span {
    width: 11px; height: 11px;
    border-radius: 50%;
    background: rgba(0,0,0,.6);
    box-shadow: inset 0 -1px 0 rgba(255,255,255,.4);
  }
  .saq-paper-tape {
    position: absolute;
    top: -12px;
    left: 50%;
    width: 110px;
    height: 22px;
    transform: translateX(-50%) rotate(-1.5deg);
    background: color-mix(in srgb, var(--gold) 65%, #c8a05a);
    opacity: 0.88;
    box-shadow: 0 3px 8px rgba(0,0,0,.25);
  }
  .saq-paper-badges {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
    gap: 10px;
  }
  .saq-paper-type {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(0,0,0,.08);
    border: 1px solid rgba(0,0,0,.18);
    color: #2a1a05;
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 10.5px;
    font-weight: 900;
    letter-spacing: 0.3px;
  }
  .saq-paper-page {
    font-size: 10.5px;
    font-weight: 800;
    color: rgba(0,0,0,.55);
  }
  .saq-paper-question {
    margin: 0 0 18px;
    font-size: 19px;
    line-height: 1.4;
    font-weight: 800;
    color: #111;
    letter-spacing: -0.3px;
  }
  .saq-paper-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Opciones */
  .saq-opt {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 14px;
    border-radius: 10px;
    border: 2px solid rgba(0,0,0,.18);
    background: rgba(255,255,255,.5);
    cursor: pointer;
    text-align: left;
    transition: all .18s ease;
    color: #1a1a1a;
  }
  .saq-opt:hover:not(:disabled) {
    border-color: var(--gold);
    background: color-mix(in srgb, var(--gold) 14%, white);
    transform: translateX(3px);
  }
  .saq-opt-selected {
    border-color: var(--gold) !important;
    background: color-mix(in srgb, var(--gold) 18%, white) !important;
    box-shadow: 0 4px 14px color-mix(in srgb, var(--gold) 30%, transparent);
  }
  .saq-opt-correct {
    border-color: #16a34a !important;
    background: #dcfce7 !important;
    box-shadow: 0 4px 14px rgba(34,197,94,0.35);
  }
  .saq-opt-wrong {
    border-color: #dc2626 !important;
    background: #fee2e2 !important;
    box-shadow: 0 4px 14px rgba(239,68,68,0.35);
    animation: saqShake 0.4s ease;
  }
  @keyframes saqShake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
  }
  .saq-opt:disabled { cursor: default; }
  .saq-opt-letter {
    width: 26px; height: 26px;
    border-radius: 50%;
    border: 2px solid currentColor;
    display: grid;
    place-items: center;
    font-size: 12px;
    font-weight: 900;
    flex-shrink: 0;
    color: #6b4818;
  }
  .saq-opt-letter.square { border-radius: 6px; }
  .saq-opt-selected .saq-opt-letter { color: #6b4818; background: rgba(255,255,255,0.7); }
  .saq-opt-correct .saq-opt-letter { color: #16a34a; background: white; }
  .saq-opt-wrong .saq-opt-letter { color: #dc2626; background: white; }
  .saq-opt-text {
    flex: 1;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.4;
    color: #1a1a1a;
  }

  /* Confianza */
  .saq-confidence {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px dashed rgba(0,0,0,.18);
    text-align: center;
  }
  .saq-confidence-label {
    display: block;
    font-size: 11.5px;
    font-weight: 800;
    color: rgba(0,0,0,.55);
    margin-bottom: 8px;
  }
  .saq-confidence-pills {
    display: flex;
    gap: 6px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .saq-conf-pill {
    border: 1.5px solid rgba(0,0,0,.18);
    background: rgba(255,255,255,.6);
    color: #2a1a05;
    border-radius: 999px;
    padding: 5px 12px;
    font-size: 11.5px;
    font-weight: 800;
    cursor: pointer;
    transition: all .2s ease;
  }
  .saq-conf-pill:hover { border-color: rgba(0,0,0,.4); }
  .saq-conf-pill.active.low {
    background: #fee2e2; border-color: #dc2626; color: #dc2626;
  }
  .saq-conf-pill.active.mid {
    background: color-mix(in srgb, var(--gold) 25%, white);
    border-color: var(--gold);
    color: #6b4818;
  }
  .saq-conf-pill.active.high {
    background: #dcfce7; border-color: #16a34a; color: #16a34a;
  }

  /* Feedback dentro del papel */
  .saq-paper-feedback {
    margin-top: 16px;
  }
  .saq-feedback {
    background: white;
    border: 2px solid;
    border-radius: 12px;
    padding: 14px;
    color: #111;
  }
  .saq-feedback-correct { border-color: #16a34a; background: #f0fdf4; }
  .saq-feedback-partial { border-color: #f59e0b; background: #fffbeb; }
  .saq-feedback-wrong   { border-color: #dc2626; background: #fef2f2; }

  .saq-feedback-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .saq-feedback-icon { font-size: 22px; }
  .saq-feedback-head strong {
    font-size: 16px;
    font-weight: 900;
    flex: 1;
  }
  .saq-feedback-correct .saq-feedback-head strong { color: #16a34a; }
  .saq-feedback-partial .saq-feedback-head strong { color: #f59e0b; }
  .saq-feedback-wrong   .saq-feedback-head strong { color: #dc2626; }
  .saq-feedback-pct {
    font-size: 14px;
    font-weight: 900;
    padding: 3px 10px;
    border-radius: 999px;
    background: white;
    border: 2px solid currentColor;
  }
  .saq-feedback-correct .saq-feedback-pct { color: #16a34a; }
  .saq-feedback-partial .saq-feedback-pct { color: #f59e0b; }
  .saq-feedback-wrong   .saq-feedback-pct { color: #dc2626; }

  .saq-feedback-bar {
    height: 6px;
    background: rgba(0,0,0,.08);
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 12px;
  }
  .saq-feedback-bar > div {
    height: 100%;
    transition: width .6s ease;
  }
  .saq-feedback-correct .saq-feedback-bar > div { background: #16a34a; }
  .saq-feedback-partial .saq-feedback-bar > div { background: #f59e0b; }
  .saq-feedback-wrong   .saq-feedback-bar > div { background: #dc2626; }

  .saq-feedback-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
    line-height: 1.5;
    color: #2a2a2a;
  }
  .saq-feedback-row b {
    display: block;
    font-size: 11px;
    font-weight: 900;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-bottom: 2px;
  }
  .saq-feedback-tip {
    margin-top: 4px;
    padding: 8px 10px;
    background: rgba(0,0,0,.05);
    border-left: 3px solid var(--gold);
    border-radius: 4px;
    font-size: 12.5px;
    color: #2a2a2a;
  }

  /* Botón de acción flotante */
  .saq-action-row {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    padding: 0 6px;
  }
  .saq-action-btn {
    border: 2px solid var(--gold);
    background: var(--gold);
    color: #0a0a0a;
    border-radius: 12px;
    padding: 12px 22px;
    font-size: 14px;
    font-weight: 900;
    cursor: pointer;
    box-shadow: 4px 5px 0 color-mix(in srgb, var(--gold) 50%, #000);
    transition: transform .15s ease, box-shadow .15s ease;
    letter-spacing: 0.3px;
  }
  .saq-action-btn:hover:not(:disabled) {
    transform: translate(-2px, -2px);
    box-shadow: 6px 7px 0 color-mix(in srgb, var(--gold) 50%, #000);
  }
  .saq-action-btn:disabled {
    background: var(--bg-card2);
    color: var(--text-faint);
    border-color: var(--border-color2);
    box-shadow: none;
    cursor: not-allowed;
  }
  .saq-action-hint {
    color: var(--text-faint);
    font-size: 12px;
    font-style: italic;
  }

  /* Responsive playing */
  @media (max-width: 1180px) {
    .saq-playing-grid { grid-template-columns: 1fr; }
    .saq-playing-side {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
    }
  }
  @media (max-width: 900px) {
    .saq-pdf-panel { display: none; }
    .saq-timeline-title { font-size: 12px; }
    .saq-tl-node { width: 18px; height: 18px; font-size: 9px; }
    .saq-tl-node.active { width: 24px; height: 24px; }
    .saq-playing-side { grid-template-columns: 1fr; }
  }
  @media (max-width: 640px) {
    .saq-paper { padding: 20px 18px 20px 44px; }
    .saq-paper-question { font-size: 16px; }
    .saq-opt-text { font-size: 13px; }
    .saq-confidence-pills { gap: 4px; }
    .saq-conf-pill { font-size: 10.5px; padding: 4px 10px; }
  }
  @media (max-width: 640px) {
    .saq-types-grid { grid-template-columns: 1fr; }
    .saq-row-2 { grid-template-columns: 1fr; }
    .saq-hero h1 { font-size: 18px; }
    .saq-hero h1 small { display: none; }
  }
`;

// ═══════════════════════════════════════════════════════════════
// StatChip
// ═══════════════════════════════════════════════════════════════
function StatChip({
  value,
  color,
  icon,
}: {
  value: number;
  color: string;
  icon: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        background: `${color}11`,
        border: `1px solid ${color}33`,
        borderRadius: 8,
        padding: '4px 10px',
      }}
    >
      <span style={{ color, fontSize: 13, fontWeight: 900 }}>{icon}</span>
      <span style={{ color, fontSize: 15, fontWeight: 900 }}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SETUP SCREEN — Dashboard StudyAL
// ═══════════════════════════════════════════════════════════════
function SetupScreen({
  themeColor,
  difficulty,
  setDifficulty,
  selectedTypes,
  setSelectedTypes,
  questionCount,
  setQuestionCount,
  customCount,
  setCustomCount,
  genError,
  onGenerate,
}: any) {
  const toggleType = (t: QuestionType) => {
    setSelectedTypes((prev: QuestionType[]) => {
      if (prev.includes(t) && prev.length > 1) return prev.filter((x: any) => x !== t);
      if (!prev.includes(t)) return [...prev, t];
      return prev;
    });
  };

  const finalCount = customCount
    ? Math.min(Math.max(parseInt(customCount) || 10, 1), 100)
    : questionCount;

  // Distribución estimada por tipo
  const perType = Math.max(1, Math.floor(finalCount / Math.max(selectedTypes.length, 1)));
  const remainder = finalCount - perType * selectedTypes.length;

  const TYPE_INFO: Record<QuestionType, { desc: string }> = {
    multiple_choice: { desc: 'Una sola respuesta correcta.' },
    multi_select:    { desc: 'Selecciona todas las correctas.' },
    true_false:      { desc: 'Responde verdadero o falso.' },
    fill_blank:      { desc: 'Completa la frase con la palabra correcta.' },
    matching:        { desc: 'Conecta conceptos relacionados.' },
    short_answer:    { desc: 'Escribe tu respuesta con tus propias palabras.' },
  };

  const estimatedTime = Math.max(1, Math.round(finalCount * 0.6));

  return (
    <motion.div
      key="setup"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="saq-setup"
    >
      {/* ============ COLUMNA IZQUIERDA ============ */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="saq-card">
          <h4>📚 Material seleccionado</h4>
          <div className="saq-card-row">
            <i style={{ background: '#ef4444' }} />
            <span>Listo para examinar</span>
          </div>
          <div className="saq-card-row">
            <span style={{ color: 'var(--text-faint)' }}>Idioma detectado</span>
            <b style={{ color: 'var(--red)' }}>Español</b>
          </div>
        </div>

        <div className="saq-card">
          <h4>🎯 ¿Qué evalúa este quiz?</h4>
          <div className="saq-card-row"><i style={{ background: 'var(--gold)' }}/>Comprensión profunda</div>
          <div className="saq-card-row"><i style={{ background: 'var(--blue)' }}/>Aplicación de conceptos</div>
          <div className="saq-card-row"><i style={{ background: 'var(--pink)' }}/>Relaciones y conexiones</div>
          <div className="saq-card-row"><i style={{ background: '#ef4444' }}/>Pensamiento crítico</div>
        </div>

        <div className="saq-tip">
          <span>💡</span>
          <p>
            <b>Consejo StudyAL:</b> mezclar tipos de preguntas te ayuda a entender desde diferentes ángulos.
          </p>
        </div>
      </aside>

      {/* ============ COLUMNA CENTRAL ============ */}
      <div className="saq-setup-center">
        <div className="saq-setup-title">
          <h2>Configura tu <b>Quiz</b></h2>
          <p>ALAI creará preguntas que realmente te hacen pensar.</p>
        </div>

        {/* TIPOS DE PREGUNTAS */}
        <div>
          <div className="saq-section-label">
            <b>1.</b> Elige los tipos de preguntas
          </div>
          <div className="saq-types-grid">
            {(Object.keys(TYPE_META) as QuestionType[]).map(t => {
              const active = selectedTypes.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  className={`saq-type-card ${active ? 'active' : ''}`}
                >
                  <div className="saq-type-check">{active ? '✓' : ''}</div>
                  <div className="saq-type-icon">{TYPE_META[t].icon}</div>
                  <div className="saq-type-title">{TYPE_META[t].label}</div>
                  <div className="saq-type-desc">{TYPE_INFO[t].desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* CANTIDAD + DIFICULTAD */}
        <div className="saq-row-2">
          <div>
            <div className="saq-section-label">
              <b>2.</b> ¿Cuántas preguntas?
            </div>
            <div className="saq-count-pills" style={{ marginBottom: 10 }}>
              {[5, 10, 15, 20, 25, 30].map(n => {
                const active = questionCount === n && !customCount;
                return (
                  <button
                    key={n}
                    onClick={() => { setQuestionCount(n); setCustomCount(''); }}
                    className={`saq-count-pill ${active ? 'active' : ''}`}
                  >
                    {n}
                  </button>
                );
              })}
              <input
                type="number"
                placeholder="otro"
                value={customCount}
                onChange={e => setCustomCount(e.target.value)}
                min={1}
                max={100}
                className="saq-count-input"
              />
            </div>
            <div className="saq-meta-box">
              ⏱ Tiempo estimado: <b>{estimatedTime} {estimatedTime === 1 ? 'minuto' : 'minutos'}</b>
            </div>
          </div>

          <div>
            <div className="saq-section-label">
              <b>3.</b> Dificultad
            </div>
            <div className="saq-diff-pills" style={{ marginBottom: 10 }}>
              {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  className={`saq-diff-pill ${difficulty === d ? 'active' : ''}`}
                >
                  {DIFF_LABEL[d]}
                </button>
              ))}
            </div>
            <div className="saq-meta-box">
              🎯 {difficulty === 'easy' && 'Repaso amigable para asentar conceptos.'}
              {difficulty === 'medium' && 'Equilibrio perfecto para aprender y desafiarte.'}
              {difficulty === 'hard' && 'Reto serio. Prepárate.'}
            </div>
          </div>
        </div>

        {/* CTA */}
        {genError && <div className="saq-error">⚠️ {genError}</div>}

        <button
          onClick={onGenerate}
          disabled={selectedTypes.length === 0}
          className="saq-generate-btn"
        >
          ✨ Generar mi quiz
        </button>
        <div style={{
          textAlign: 'center',
          fontSize: 11.5,
          color: 'var(--text-faint)',
          marginTop: -8,
        }}>
          ALAI necesita unos segundos para crear algo épico para ti.
        </div>
      </div>

      {/* ============ COLUMNA DERECHA ============ */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="saq-card">
          <h4>👁 Vista previa</h4>
          {selectedTypes.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '6px 0' }}>
              Elige al menos un tipo de pregunta.
            </div>
          ) : (
            <>
              {(Object.keys(TYPE_META) as QuestionType[]).filter(t => selectedTypes.includes(t)).map((t, i) => {
                const count = i === 0 ? perType + remainder : perType;
                return (
                  <div key={t} className="saq-card-row">
                    <span>{TYPE_META[t].icon}</span>
                    <span style={{ fontSize: 12 }}>{TYPE_META[t].label}</span>
                    <b>{count}</b>
                  </div>
                );
              })}
              <div style={{
                marginTop: 10, paddingTop: 10,
                borderTop: '1px dashed var(--border-color2)',
                display: 'flex', justifyContent: 'space-between',
                fontSize: 13, fontWeight: 900,
              }}>
                <span style={{ color: 'var(--text-secondary)' }}>Total</span>
                <span style={{ color: 'var(--gold)' }}>{finalCount} preguntas</span>
              </div>
            </>
          )}
        </div>

        <div className="saq-card">
          <h4>✨ Esto es lo que lograrás</h4>
          <div className="saq-card-row">🧠 Evaluarás tu comprensión real del contenido.</div>
          <div className="saq-card-row">📈 Identificarás tus fortalezas y debilidades.</div>
          <div className="saq-card-row">💬 Recibirás explicaciones inteligentes de ALAI.</div>
        </div>

        <div className="saq-tip">
          <span>⚡</span>
          <p>
            <b>Recuerda:</b> no se trata de memorizar, sino de <b>entender y aplicar</b>.
          </p>
        </div>
      </aside>
    </motion.div>
  );
}

function SectionLabel({
  color,
  icon,
  label,
}: {
  color: string;
  icon: string;
  label: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        fontWeight: 800,
        color,
        letterSpacing: 2,
        marginBottom: 14,
        fontFamily: BODY,
      }}
    >
      <span>{icon}</span>
      {label}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// QUESTION CARD — Hoja de cuaderno StudyAL
// ═══════════════════════════════════════════════════════════════
function QuestionCard({
  question,
  index,
  total,
  themeColor,
  userAnswer,
  setUserAnswer,
  isLocked,
  lastEntry,
  showWordBank,
  setShowWordBank,
  onVerify,
  isEvaluating,
  onNext,
  isLast,
}: {
  question: Question;
  index: number;
  total: number;
  themeColor: string;
  userAnswer: any;
  setUserAnswer: (v: any) => void;
  isLocked: boolean;
  lastEntry: HistoryEntry | null;
  showWordBank: boolean;
  setShowWordBank: (v: boolean) => void;
  onVerify: (directAnswer?: any) => void;
  isEvaluating: boolean;
  onNext: () => void;
  isLast: boolean;
}) {
  const isCorrect = lastEntry?.correct ?? null;
  const [confidence, setConfidence] = useState<null | 'low' | 'mid' | 'high'>(null);

  useEffect(() => {
    setConfidence(null);
  }, [index]);

  // Keyboard: Enter para verificar/siguiente
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (!isLocked && userAnswer !== null) { e.preventDefault(); onVerify(); }
        else if (isLocked) { e.preventDefault(); onNext(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isLocked, userAnswer, onVerify, onNext]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ type: 'spring', stiffness: 200, damping: 26 }}
      className="saq-qcard-wrap"
    >
      {/* Hoja de cuaderno */}
      <div className="saq-paper">
        {/* Espiral lateral izquierda */}
        <div className="saq-paper-spiral">
          {Array.from({ length: 14 }).map((_, i) => <span key={i} />)}
        </div>

        {/* Cinta superior decorativa */}
        <div className="saq-paper-tape" />

        {/* Badge tipo de pregunta */}
        <div className="saq-paper-badges">
          <span className="saq-paper-type">
            {TYPE_META[question.type]?.icon} {TYPE_META[question.type]?.label}
          </span>
          {question.sourcePage && (
            <span className="saq-paper-page">📄 Pág. {question.sourcePage}</span>
          )}
        </div>

        {/* Pregunta */}
        <h2 className="saq-paper-question">
          <MathText text={question.question} />
        </h2>

        {/* Opciones */}
        <div className="saq-paper-options">
          <QuestionOptions
            question={question}
            userAnswer={userAnswer}
            setUserAnswer={setUserAnswer}
            isLocked={isLocked}
            isEvaluating={isEvaluating}
            themeColor={themeColor}
            showWordBank={showWordBank}
            setShowWordBank={setShowWordBank}
            onVerifyDirect={onVerify}
          />
        </div>

        {/* Confianza (solo si no está locked) */}
        {!isLocked && (
          <div className="saq-confidence">
            <span className="saq-confidence-label">¿Qué tan seguro estás?</span>
            <div className="saq-confidence-pills">
              <button
                className={`saq-conf-pill ${confidence === 'low' ? 'active low' : ''}`}
                onClick={() => setConfidence('low')}
                type="button"
              >
                😕 No sé
              </button>
              <button
                className={`saq-conf-pill ${confidence === 'mid' ? 'active mid' : ''}`}
                onClick={() => setConfidence('mid')}
                type="button"
              >
                🤔 Creo que sí
              </button>
              <button
                className={`saq-conf-pill ${confidence === 'high' ? 'active high' : ''}`}
                onClick={() => setConfidence('high')}
                type="button"
              >
                💪 Muy seguro
              </button>
            </div>
          </div>
        )}

        {/* Feedback inline cuando ya está locked */}
        {isLocked && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="saq-paper-feedback"
          >
            <FeedbackBox
              correct={isCorrect ?? false}
              question={question}
              userAnswer={lastEntry?.userAnswer}
              themeColor={themeColor}
              evaluation={lastEntry?.evaluation}
            />
          </motion.div>
        )}
      </div>

      {/* Botón flotante de acción */}
      <div className="saq-action-row">
        {!isLocked ? (
          (question.type === 'fill_blank' ||
            question.type === 'short_answer' ||
            question.type === 'multi_select' ||
            question.type === 'matching') ? (
            <button
              disabled={
                userAnswer === null ||
                userAnswer === undefined ||
                (Array.isArray(userAnswer) && userAnswer.length === 0) ||
                (typeof userAnswer === 'string' && !userAnswer.trim())
              }
              onClick={() => onVerify()}
              className="saq-action-btn"
            >
              {isEvaluating ? '🧠 VERIFICANDO...' : 'Responder →'}
            </button>
          ) : (
            <div className="saq-action-hint">
              Haz clic en una opción para responder
            </div>
          )
        ) : (
          <button
            data-next-question
            onClick={onNext}
            className="saq-action-btn"
          >
            {isLast ? '✓ Ver resultados' : 'Siguiente pregunta →'}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── FeedbackBox ──────────────────────────────────────────────
function FeedbackBox({
  correct,
  question,
  userAnswer,
  themeColor,
  evaluation,
}: {
  correct: boolean;
  question: Question;
  userAnswer: any;
  themeColor: string;
  evaluation?: HistoryEntry['evaluation'];
}) {
  const pct = evaluation?.porcentaje ?? (correct ? 100 : 0);
  const state = pct >= 85 ? 'correct' : pct >= 50 ? 'partial' : 'wrong';
  const title = state === 'correct' ? '¡Correcto!' : state === 'partial' ? 'Casi…' : 'Incorrecto';
  const icon = state === 'correct' ? '🎉' : state === 'partial' ? '🤏' : '💭';

  return (
    <div id="quiz-feedback" className={`saq-feedback saq-feedback-${state}`}>
      <div className="saq-feedback-head">
        <span className="saq-feedback-icon">{icon}</span>
        <strong>{title}</strong>
        <span className="saq-feedback-pct">{pct}%</span>
      </div>

      <div className="saq-feedback-bar">
        <div style={{ width: `${pct}%` }} />
      </div>

      <div className="saq-feedback-body">
        {evaluation?.respuestaCorrecta && (
          <div className="saq-feedback-row">
            <b>Respuesta correcta:</b>
            <span>{evaluation.respuestaCorrecta}</span>
          </div>
        )}

        {evaluation?.analisis && (
          <div className="saq-feedback-row">
            <b>Análisis:</b>
            <span>{evaluation.analisis}</span>
          </div>
        )}

        {evaluation?.explicacion && (
          <div className="saq-feedback-row">
            <b>¿Por qué?</b>
            <span>{evaluation.explicacion}</span>
          </div>
        )}

        {evaluation?.consejo && (
          <div className="saq-feedback-tip">
            💡 {evaluation.consejo}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// QUESTION OPTIONS — 6 tipos
// ═══════════════════════════════════════════════════════════════
function QuestionOptions({
  question,
  userAnswer,
  setUserAnswer,
  isLocked,
  isEvaluating,
  themeColor,
  showWordBank,
  setShowWordBank,
  onVerifyDirect,
}: {
  question: Question;
  userAnswer: any;
  setUserAnswer: (v: any) => void;
  isLocked: boolean;
  isEvaluating: boolean;
  themeColor: string;
  showWordBank: boolean;
  setShowWordBank: (v: boolean) => void;
  onVerifyDirect?: (answer: any) => void;
}) {
  // 1. MULTIPLE CHOICE — click directo = respuesta inmediata
  if (question.type === 'multiple_choice') {
    return (
      <>
        {question.options?.map((opt, i) => {
          const selected = userAnswer === i;
          const showRight = isLocked && i === question.correctAnswer;
          const showWrong = isLocked && selected && i !== question.correctAnswer;
          return (
            <OptionButton
              key={i}
              label={String.fromCharCode(65 + i)}
              text={opt}
              selected={selected}
              correct={showRight}
              wrong={showWrong}
              disabled={isLocked}
              themeColor={themeColor}
              onClick={() => {
                if (isLocked) return;
                onVerifyDirect?.(i);
              }}
            />
          );
        })}
      </>
    );
  }

  // 2. MULTI SELECT
  if (question.type === 'multi_select') {
    const current: number[] = Array.isArray(userAnswer) ? userAnswer : [];
    return (
      <>
        <div style={{ fontSize: 12, color: '#888', fontFamily: BODY, marginBottom: 4 }}>
          Selecciona todas las correctas
        </div>
        {question.options?.map((opt, i) => {
          const selected = current.includes(i);
          const showRight = isLocked && (question.correctAnswers ?? []).includes(i);
          const showWrong = isLocked && selected && !(question.correctAnswers ?? []).includes(i);
          return (
            <OptionButton
              key={i}
              label="□"
              text={opt}
              selected={selected}
              correct={showRight}
              wrong={showWrong}
              disabled={isLocked}
              themeColor={themeColor}
              square
              onClick={() => {
                if (isLocked) return;
                setUserAnswer(
                  selected ? current.filter(x => x !== i) : [...current, i]
                );
              }}
            />
          );
        })}
      </>
    );
  }

  // 3. TRUE / FALSE — click directo = respuesta inmediata
  if (question.type === 'true_false') {
    const opts = ['Verdadero', 'Falso'];
    // correctIdx: 0 = Verdadero, 1 = Falso
    const correctIsTrue = question.correctAnswer === true
      || question.correctAnswer === 0
      || String(question.correctAnswer).toLowerCase() === 'true'
      || String(question.correctAnswer).toLowerCase() === 'verdadero';
    const correctIdx = correctIsTrue ? 0 : 1;
    return (
      <>
        {opts.map((opt, i) => {
          const selected = userAnswer === i;
          const showRight = isLocked && i === correctIdx;
          const showWrong = isLocked && selected && i !== correctIdx;
          return (
            <OptionButton
              key={i}
              label={i === 0 ? 'V' : 'F'}
              text={opt}
              selected={selected}
              correct={showRight}
              wrong={showWrong}
              disabled={isLocked}
              themeColor={themeColor}
              onClick={() => {
                if (isLocked) return;
                onVerifyDirect?.(i);
              }}
            />
          );
        })}
      </>
    );
  }

  // 4. FILL BLANK
  if (question.type === 'fill_blank') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="text"
          value={userAnswer ?? ''}
          onChange={e => !isLocked && setUserAnswer(e.target.value)}
          disabled={isLocked}
          placeholder="Escribe la palabra aquí..."
          onKeyDown={e => {
            if (e.key !== 'Enter') return;

            e.preventDefault();

            if (isEvaluating) return;

            if (!isLocked && userAnswer) {
              onVerifyDirect?.(userAnswer);
              return;
            }

            if (isLocked) {
              setTimeout(() => {
                const btn =
                  document.querySelector(
                    '[data-next-question]'
                  ) as HTMLButtonElement | null;

                btn?.click();
              },700);
            }
          }}
          style={{
            padding: '16px 18px',
            borderRadius: 14,
            border:
isLocked
? '2px solid #4caf50'
: '2px solid rgba(0,0,0,.15)',
            background:
isLocked
? '#e8f5e9'
: '#fff',
            color: '#111',
            fontSize: 17,
            fontFamily: BODY,
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
        {/* Word Bank accordion */}
        {question.wordBank &&
question.wordBank
.length > 0 && (
          <div
            style={{
              background: '#f1f3f5',
              borderRadius: 14,
              overflow: 'hidden',
              border: '1px solid rgba(0,0,0,0.08)',
            }}
          >
            <button
              onClick={() => setShowWordBank(!showWordBank)}
              style={{
                width: '100%',
                padding: '10px 16px',
                border: 'none',
                background: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 800,
                color: '#777',
                fontFamily: BODY,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                letterSpacing: 1,
              }}
            >
              <span>📦 BANCO DE PALABRAS</span>
              <span>{showWordBank ? '▲' : '▼'}</span>
            </button>
            <AnimatePresence>
              {showWordBank && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  style={{
                    overflow: 'hidden',
                    padding: '4px 16px 16px',
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  {question.wordBank.map(w => (
                    <button
                      key={w}
                      onClick={() => !isLocked && setUserAnswer(w)}
                      disabled={isLocked}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 10,
                        background:
                          userAnswer === w ? '#1a1a2e' : '#fff',
                        color: userAnswer === w ? '#fff' : '#333',
                        border: `1.5px solid ${userAnswer === w ? '#1a1a2e' : '#ddd'}`,
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: isLocked ? 'default' : 'pointer',
                        fontFamily: BODY,
                        transition: 'all 0.15s',
                      }}
                    >
                      {w}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    );
  }

  // 5. MATCHING — drag & drop
  if (question.type === 'matching') {
    return (
      <MatchingQuestion
        question={question}
        userAnswer={userAnswer}
        setUserAnswer={setUserAnswer}
        isLocked={isLocked}
        themeColor={themeColor}
      />
    );
  }

  // 6. SHORT ANSWER
  if (question.type === 'short_answer') {
    return (
      <div>
        <textarea
          value={userAnswer ?? ''}
          onChange={e => !isLocked && setUserAnswer(e.target.value)}
          disabled={isLocked}
          placeholder="Escribe tu respuesta aquí... (Enter para verificar)"
          rows={4}
          onKeyDown={e => {
            if(
              e.key==='Enter' &&
              !e.shiftKey
            ){
              e.preventDefault();

              if(
                isEvaluating
              ) return;

              if(
                !isLocked &&
                userAnswer
              ){
                onVerifyDirect?.(
                  userAnswer
                );
              }
            }
          }}
          style={{
            width: '100%',
            padding: '16px 18px',
            borderRadius: 14,
            border:
isLocked
? '2px solid #4caf50'
: '2px solid rgba(0,0,0,.15)',
            background:
isLocked
? '#e8f5e9'
: '#fff',
            color: '#111',
            fontSize: 16,
            fontFamily: BODY,
            outline: 'none',
            resize: 'vertical',
            boxSizing: 'border-box',
            lineHeight: 1.5,
          }}
        />
      </div>
    );
  }

  return null;
}

// ─── OptionButton ─────────────────────────────────────────────
function OptionButton({
  label,
  text,
  selected,
  correct,
  wrong,
  disabled,
  themeColor,
  onClick,
  square = false,
}: {
  label: string;
  text: string;
  selected: boolean;
  correct: boolean;
  wrong: boolean;
  disabled: boolean;
  themeColor: string;
  onClick: () => void;
  square?: boolean;
}) {
  const state = correct ? 'correct' : wrong ? 'wrong' : selected ? 'selected' : 'idle';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`saq-opt saq-opt-${state}`}
      type="button"
    >
      <div className={`saq-opt-letter ${square ? 'square' : ''}`}>
        {correct ? '✓' : wrong ? '✗' : label}
      </div>
      <span className="saq-opt-text">
        <MathText text={text} />
      </span>
    </button>
  );
}

// ─── Matching con Reorder ─────────────────────────────────────
function MatchingQuestion({
  question,
  userAnswer,
  setUserAnswer,
  isLocked,
  themeColor,
}: {
  question: Question;
  userAnswer: any;
  setUserAnswer: (v: any) => void;
  isLocked: boolean;
  themeColor: string;
}) {
  return (
    <MatchingCanvas
      pairs={question.pairs || []}
      value={userAnswer || {}}
      onChange={setUserAnswer}
      locked={isLocked}
      themeColor={themeColor}
    />
  );
}

// ═══════════════════════════════════════════════════════════════
// RESULTS SCREEN
// ═══════════════════════════════════════════════════════════════
function ResultsScreen({
  stats,
  history,
  mot,
  difficulty,
  selectedTypes,
  themeColor,
  onRestart,
  onRetryWrong,
  onReview,
  formatTime,
}: any) {
  const wrongCount = history.filter((h: HistoryEntry) => !h.correct).length;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      style={{
        width: '100%',
        maxWidth: 640,
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      {/* Score principal */}
      <div
        style={{
          textAlign: 'center',
          padding: '40px 32px 32px',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: 28,
          border: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div style={{ fontSize: 60, marginBottom: 8 }}>{mot.emoji}</div>
        <div
          style={{
            fontFamily: HAND,
            fontSize: 88,
            color: mot.color,
            lineHeight: 1,
            marginBottom: 4,
            textShadow: `0 0 40px ${mot.color}55`,
          }}
        >
          {stats.pct}%
        </div>
        <div
          style={{
            fontSize: 20,
            color: '#aaa',
            fontFamily: HAND,
            marginBottom: 20,
          }}
        >
          {mot.msg}
        </div>

        {/* Stats grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12,
          }}
        >
          {[
            { val: stats.correct,   label: 'Correctas', color: '#4ade80', icon: '✓' },
            { val: stats.incorrect, label: 'Incorrectas', color: '#f87171', icon: '✗' },
            { val: formatTime(stats.totalTime), label: 'Tiempo',    color: '#a78bfa', icon: '⏱' },
            { val: `${stats.avgTime}s`,          label: 'Por preg.', color: '#fbbf24', icon: '⚡' },
          ].map(s => (
            <div
              key={s.label}
              style={{
                padding: '16px 8px',
                background: `${s.color}0d`,
                border: `1px solid ${s.color}22`,
                borderRadius: 16,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 18, color: s.color, marginBottom: 4 }}>
                {s.icon}
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 900,
                  color: s.color,
                  fontFamily: BODY,
                }}
              >
                {s.val}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: '#555',
                  fontFamily: BODY,
                  marginTop: 2,
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Meta info */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}
      >
        <MetaChip
          icon="🎯"
          label={`Dificultad: ${DIFF_LABEL[difficulty as Difficulty]}`}
          color={DIFF_COLOR[difficulty as Difficulty]}
        />
        <MetaChip
          icon="📋"
          label={`${selectedTypes.length} tipo${selectedTypes.length > 1 ? 's' : ''}`}
          color="#a78bfa"
        />
        <MetaChip
          icon="❓"
          label={`${history.length} preguntas`}
          color="#22d3ee"
        />
      </div>

      {/* Recomendación */}
      {wrongCount > 0 && (
        <div
          style={{
            padding: '16px 20px',
            background: '#f8717110',
            border: '1px dashed #f8717155',
            borderRadius: 16,
            fontSize: 14,
            color: '#f87171',
            fontFamily: BODY,
            lineHeight: 1.5,
          }}
        >
          💡 Tenés <strong>{wrongCount}</strong>{' '}
          {wrongCount === 1 ? 'pregunta incorrecta' : 'preguntas incorrectas'}. ¡Repasalas para dominar el tema!
        </div>
      )}

      {/* Botones */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {wrongCount > 0 && (
          <button
            onClick={onRetryWrong}
            style={{
              width: '100%',
              padding: '18px',
              borderRadius: 16,
              border: 'none',
              cursor: 'pointer',
              background: `linear-gradient(135deg, #f87171, #ef4444)`,
              color: '#fff',
              fontWeight: 900,
              fontSize: 17,
              fontFamily: BODY,
              boxShadow: '0 8px 24px rgba(239,68,68,0.4)',
            }}
          >
            🔄 REPETIR SOLO INCORRECTAS ({wrongCount})
          </button>
        )}
        <button
          onClick={onReview}
          style={{
            width: '100%',
            padding: '16px',
            borderRadius: 16,
            border: '1.5px solid rgba(255,255,255,0.1)',
            cursor: 'pointer',
            background: 'rgba(255,255,255,0.04)',
            color: '#ccc',
            fontWeight: 700,
            fontSize: 15,
            fontFamily: BODY,
          }}
        >
          📖 REVISAR RESPUESTAS
        </button>
        <button
          onClick={onRestart}
          style={{
            width: '100%',
            padding: '18px',
            borderRadius: 16,
            border: 'none',
            cursor: 'pointer',
            background: themeColor,
            color: '#000',
            fontWeight: 900,
            fontSize: 17,
            fontFamily: BODY,
            boxShadow: `0 8px 24px ${themeColor}44`,
          }}
        >
          ✨ NUEVO QUIZ
        </button>
      </div>
    </motion.div>
  );
}

function MetaChip({
  icon,
  label,
  color,
}: {
  icon: string;
  label: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 14px',
        borderRadius: 99,
        background: `${color}12`,
        border: `1px solid ${color}33`,
        fontSize: 13,
        color,
        fontWeight: 700,
        fontFamily: BODY,
      }}
    >
      {icon} {label}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// REVIEW SCREEN
// ═══════════════════════════════════════════════════════════════
function ReviewScreen({
  history,
  themeColor,
  onBack,
}: {
  history: HistoryEntry[];
  themeColor: string;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'correct' | 'wrong'>('all');

  const filtered = history.filter(h => {
    if (filter === 'correct') return h.correct;
    if (filter === 'wrong')   return !h.correct;
    return true;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      style={{ width: '100%', maxWidth: 720 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <div style={{ fontFamily: HAND, fontSize: 36, color: '#fff' }}>
          📖 Revisión de respuestas
        </div>
        <button
          onClick={onBack}
          style={{
            padding: '8px 16px',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'transparent',
            color: '#aaa',
            cursor: 'pointer',
            fontSize: 14,
            fontFamily: BODY,
          }}
        >
          ← Volver
        </button>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(
          [
            { key: 'all',     label: 'Todas', count: history.length },
            { key: 'correct', label: '✓ Correctas', count: history.filter(h => h.correct).length },
            { key: 'wrong',   label: '✗ Incorrectas', count: history.filter(h => !h.correct).length },
          ] as const
        ).map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: '8px 16px',
              borderRadius: 10,
              border: `1.5px solid ${filter === f.key ? themeColor : 'rgba(255,255,255,0.1)'}`,
              background: filter === f.key ? `${themeColor}22` : 'transparent',
              color: filter === f.key ? themeColor : '#666',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 700,
              fontFamily: BODY,
            }}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* Lista */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {filtered.map((entry, i) => (
          <ReviewItem key={i} entry={entry} index={i} themeColor={themeColor} />
        ))}
      </div>
    </motion.div>
  );
}

function ReviewItem({
  entry,
  index,
  themeColor,
}: {
  entry: HistoryEntry;
  index: number;
  themeColor: string;
}) {
  const [open, setOpen] = useState(false);
  const { question: q, correct, userAnswer } = entry;

  const userLabel = (() => {
    if (q.type === 'multiple_choice') return q.options?.[userAnswer] ?? String(userAnswer ?? '');
    if (q.type === 'true_false') return userAnswer === 0 ? 'Verdadero' : 'Falso';
    if (q.type === 'multi_select')
      return (Array.isArray(userAnswer) ? userAnswer : [])
        .map((i: number) => q.options?.[i])
        .filter(Boolean)
        .join(', ');
    return String(userAnswer ?? '');
  })();

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${correct ? '#4ade8033' : '#f8717133'}`,
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: correct ? '#4ade8022' : '#f8717122',
            border: `2px solid ${correct ? '#4ade80' : '#f87171'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            color: correct ? '#4ade80' : '#f87171',
            fontWeight: 900,
            flexShrink: 0,
          }}
        >
          {correct ? '✓' : '✗'}
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              color: '#ddd',
              fontFamily: BODY,
              fontWeight: 600,
              lineHeight: 1.4,
              marginBottom: 4,
            }}
          >
            {index + 1}. {q.question}
          </div>
          <div style={{ fontSize: 12, color: '#666', fontFamily: BODY }}>
            {TYPE_META[q.type]?.icon} {TYPE_META[q.type]?.label}
            {q.sourcePage && ` · Pág. ${q.sourcePage}`}
          </div>
        </div>
        <span style={{ color: '#555', fontSize: 16 }}>{open ? '▲' : '▼'}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                padding: '0 20px 20px 62px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {userLabel && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: correct ? '#4ade8011' : '#f8717111',
                    borderRadius: 10,
                    fontSize: 13,
                    color: correct ? '#4ade80' : '#f87171',
                    fontFamily: BODY,
                  }}
                >
                  <strong>Tu respuesta:</strong> {userLabel}
                </div>
              )}
              {q.explanation && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: 10,
                    fontSize: 13,
                    color: '#bbb',
                    fontFamily: BODY,
                    lineHeight: 1.5,
                  }}
                >
                  💡 {q.explanation}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
