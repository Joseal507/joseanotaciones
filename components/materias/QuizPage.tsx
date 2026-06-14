'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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

const HAND = "'Patrick Hand', cursive";
const BODY = "'Inter', system-ui, sans-serif";

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
export default function QuizPage({
  materiales,
  seleccion,
  tema,
  materia,
  onBack,
}: any) {
  const themeColor = tema?.color || '#22d3ee';

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

  // ── Helpers de selección (igual que FlashcardsPage) ──────
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

  // ── Filtrar texto por páginas (igual que FlashcardsPage) ──
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

  // ── Extraer texto real de los materiales (igual que FlashcardsPage) ──
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

      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: texto,
          count: finalCount,
          nivel: difficulty,
          tipos: selectedTypes,
          seleccion,
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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#080810',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: BODY,
        zIndex: 9999,
        overflow: 'hidden',
      }}
    >
      {/* ── HEADER ─────────────────────────────────────────── */}
      <header
        style={{
          height: 64,
          background: 'rgba(255,255,255,0.02)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          gap: 20,
          flexShrink: 0,
          zIndex: 100,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            padding: '7px 16px',
            color: '#aaa',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: BODY,
            whiteSpace: 'nowrap',
          }}
        >
          ← Salir
        </button>

        <div
          style={{
            fontFamily: HAND,
            fontSize: 26,
            color: themeColor,
            flexShrink: 0,
          }}
        >
          Quiz
          <span style={{ color: '#fff', opacity: 0.35, marginLeft: 8, fontSize: 18 }}>
            {tema?.nombre}
          </span>
        </div>

        {/* Barra de progreso central */}
        {quizState === 'playing' && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              maxWidth: 500,
              margin: '0 auto',
            }}
          >
            <div
              style={{
                flex: 1,
                height: 6,
                background: 'rgba(255,255,255,0.07)',
                borderRadius: 99,
                overflow: 'hidden',
              }}
            >
              <motion.div
                initial={{ width: 0 }}
                animate={{
                  width: `${((currentIndex + 1) / questions.length) * 100}%`,
                }}
                transition={{ type: 'spring', stiffness: 120 }}
                style={{
                  height: '100%',
                  background: themeColor,
                  boxShadow: `0 0 10px ${themeColor}88`,
                  borderRadius: 99,
                }}
              />
            </div>
            <span
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: themeColor,
                minWidth: 55,
                textAlign: 'right',
              }}
            >
              {currentIndex + 1}/{questions.length}
            </span>
          </div>
        )}

        {/* Stats derecha */}
        {quizState === 'playing' && (
          <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
            <StatChip value={liveCorrect}   color="#4ade80" icon="✓" />
            <StatChip value={liveIncorrect} color="#f87171" icon="✗" />
            <div
              style={{
                fontSize: 13,
                color: '#555',
                fontWeight: 600,
                minWidth: 38,
                textAlign: 'right',
              }}
            >
              ⏱ {formatTime(elapsed)}
            </div>
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

        {/* PDF lado izquierdo — igual que FlashcardsPage */}
        {quizState === 'playing' && (
          <div style={{
            flex: '0 0 50%',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: '#000',
          }}>
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
        )}

{/* Panel derecho */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '40px 32px 80px',
            position: 'relative',
            zIndex: 2,
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

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

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
// SETUP SCREEN
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

  return (
    <motion.div
      key="setup"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      style={{ width: '100%', maxWidth: 680 }}
    >
      <h1
        style={{
          fontFamily: HAND,
          fontSize: 52,
          margin: '0 0 6px',
          textAlign: 'center',
          color: '#fff',
        }}
      >
        Configura tu Quiz
      </h1>
      <p
        style={{
          textAlign: 'center',
          color: '#555',
          marginBottom: 44,
          fontSize: 15,
        }}
      >
        Personaliza tu examen y comenzá a estudiar
      </p>

      {/* DIFICULTAD */}
      <SectionLabel color={themeColor} icon="🎯" label="DIFICULTAD" />
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 36,
          background: 'rgba(255,255,255,0.02)',
          padding: 6,
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => (
          <button
            key={d}
            onClick={() => setDifficulty(d)}
            style={{
              flex: 1,
              padding: '15px 10px',
              borderRadius: 12,
              border: 'none',
              cursor: 'pointer',
              fontWeight: 800,
              fontSize: 15,
              fontFamily: BODY,
              transition: 'all 0.25s',
              background:
                difficulty === d
                  ? DIFF_COLOR[d]
                  : 'transparent',
              color: difficulty === d ? '#000' : '#444',
              boxShadow:
                difficulty === d
                  ? `0 8px 20px ${DIFF_COLOR[d]}55`
                  : 'none',
              transform: difficulty === d ? 'scale(1.03)' : 'scale(1)',
            }}
          >
            {DIFF_LABEL[d]}
          </button>
        ))}
      </div>

      {/* TIPOS */}
      <SectionLabel color={themeColor} icon="📋" label="TIPOS DE PREGUNTA" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          gap: 10,
          marginBottom: 36,
        }}
      >
        {(Object.keys(TYPE_META) as QuestionType[]).map(t => {
          const active = selectedTypes.includes(t);
          return (
            <button
              key={t}
              onClick={() => toggleType(t)}
              style={{
                padding: '16px 14px',
                borderRadius: 16,
                border: `2px solid`,
                borderColor: active ? themeColor : 'rgba(255,255,255,0.07)',
                background: active ? `${themeColor}14` : 'rgba(255,255,255,0.02)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s',
                transform: active ? 'scale(1.03)' : 'scale(1)',
              }}
            >
              <div style={{ fontSize: 22, marginBottom: 6 }}>
                {TYPE_META[t].icon}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: active ? '#fff' : '#555',
                  fontFamily: BODY,
                  lineHeight: 1.2,
                }}
              >
                {TYPE_META[t].label}
              </div>
              {active && (
                <div
                  style={{
                    marginTop: 4,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: themeColor,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    color: '#000',
                    fontWeight: 900,
                  }}
                >
                  ✓
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* CANTIDAD */}
      <SectionLabel color={themeColor} icon="🔢" label="CANTIDAD DE PREGUNTAS" />
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: 44,
          flexWrap: 'wrap',
        }}
      >
        {[10, 20, 30, 50].map(n => {
          const active = questionCount === n && !customCount;
          return (
            <button
              key={n}
              onClick={() => {
                setQuestionCount(n);
                setCustomCount('');
              }}
              style={{
                width: 54,
                height: 54,
                borderRadius: 14,
                border: '1.5px solid',
                borderColor: active ? themeColor : 'rgba(255,255,255,0.1)',
                background: active ? `${themeColor}22` : 'transparent',
                color: active ? themeColor : '#555',
                fontSize: 16,
                fontWeight: 900,
                cursor: 'pointer',
                fontFamily: BODY,
                transition: 'all 0.2s',
              }}
            >
              {n}
            </button>
          );
        })}
        <input
          type="number"
          placeholder="Otro (máx 100)"
          value={customCount}
          onChange={e => setCustomCount(e.target.value)}
          min={1}
          max={100}
          style={{
            flex: 1,
            minWidth: 140,
            background: 'rgba(255,255,255,0.03)',
            border: `1.5px solid ${customCount ? themeColor : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 14,
            padding: '14px 18px',
            color: '#fff',
            fontSize: 15,
            fontFamily: BODY,
            outline: 'none',
          }}
        />
      </div>

      {genError && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: 12,
            background: '#f8717122',
            border: '1px solid #f8717166',
            color: '#f87171',
            fontSize: 14,
            marginBottom: 20,
            fontFamily: BODY,
          }}
        >
          ⚠️ {genError}
        </div>
      )}

      <button
        onClick={onGenerate}
        style={{
          width: '100%',
          padding: '22px',
          borderRadius: 20,
          background: `linear-gradient(135deg, ${themeColor}, ${themeColor}bb)`,
          color: '#000',
          fontWeight: 900,
          fontSize: 19,
          border: 'none',
          cursor: 'pointer',
          fontFamily: BODY,
          letterSpacing: 0.5,
          boxShadow: `0 12px 32px ${themeColor}44`,
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
          (e.currentTarget as HTMLElement).style.boxShadow = `0 18px 40px ${themeColor}66`;
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
          (e.currentTarget as HTMLElement).style.boxShadow = `0 12px 32px ${themeColor}44`;
        }}
      >
        ✨ EMPEZAR EXAMEN
      </button>
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
// QUESTION CARD — hoja de cuaderno
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
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ type: 'spring', stiffness: 200, damping: 26 }}
      style={{ width: '100%', maxWidth: 720 }}
    >
      {/* Tarjeta estilo hoja */}
      <div
        style={{
          position: 'relative',
          background: '#f5f5f0',
          borderRadius: 28,
          padding: '52px 44px 44px 76px',
          color: '#1a1a1a',
          boxShadow:
            '0 32px 80px rgba(0,0,0,0.55), 0 8px 24px rgba(0,0,0,0.35)',
          backgroundImage: `repeating-linear-gradient(
            transparent,
            transparent 35px,
            rgba(0,0,0,0.06) 35px,
            rgba(0,0,0,0.06) 36px
          )`,
          backgroundPosition: '0 52px',
        }}
      >
        {/* Agujeros espiral */}
        <div
          style={{
            position: 'absolute',
            left: 20,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            flexDirection: 'column',
            gap: 28,
          }}
        >
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: '#080810',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6)',
              }}
            />
          ))}
        </div>

        {/* Margen rojo */}
        <div
          style={{
            position: 'absolute',
            left: 58,
            top: 0,
            bottom: 0,
            width: 2,
            background: 'rgba(239,68,68,0.4)',
          }}
        />

        {/* Badge tipo */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: themeColor,
            color: '#000',
            borderRadius: 8,
            padding: '4px 12px',
            fontSize: 11,
            fontWeight: 900,
            marginBottom: 16,
            fontFamily: BODY,
            letterSpacing: 1,
          }}
        >
          {TYPE_META[question.type]?.icon}{' '}
          {question.type.replace(/_/g, ' ').toUpperCase()}
        </div>

        {/* Pregunta */}
        <h2
          style={{
            fontSize: 22,
            fontWeight: 700,
            lineHeight: 1.45,
            color: '#111',
            marginBottom: 32,
            fontFamily: BODY,
          }}
        >
          <MathText text={question.question} />
        </h2>

        {/* Opciones */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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

        {/* Footer: verificar / feedback / siguiente */}
        <div style={{ marginTop: 32 }}>
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
                style={{
                  width: '100%',
                  padding: '18px',
                  borderRadius: 16,
                  border: 'none',
                  cursor:
                    userAnswer === null ||
                    userAnswer === undefined ||
                    (Array.isArray(userAnswer) && userAnswer.length === 0) ||
                    (typeof userAnswer === 'string' && !userAnswer.trim())
                      ? 'not-allowed'
                      : 'pointer',
                  background:
                    userAnswer === null ||
                    userAnswer === undefined ||
                    (Array.isArray(userAnswer) && userAnswer.length === 0) ||
                    (typeof userAnswer === 'string' && !userAnswer.trim())
                      ? '#ccc'
                      : `linear-gradient(135deg, ${themeColor}, ${themeColor}cc)`,
                  color: '#000',
                  fontWeight: 900,
                  fontSize: 17,
                  fontFamily: BODY,
                  transition: 'all 0.2s',
                  boxShadow:
                    userAnswer !== null &&
                    userAnswer !== undefined &&
                    !(Array.isArray(userAnswer) && userAnswer.length === 0) &&
                    !(typeof userAnswer === 'string' && !userAnswer.trim())
                      ? `0 8px 24px ${themeColor}44`
                      : 'none',
                }}
              >
                {isEvaluating ? '🧠 VERIFICANDO...' : 'VERIFICAR ✓'}
              </button>
            ) : null
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {/* Feedback box */}
              <FeedbackBox
                correct={isCorrect ?? false}
                question={question}
                userAnswer={lastEntry?.userAnswer}
                themeColor={themeColor}
                evaluation={lastEntry?.evaluation}
              />
              <button
                data-next-question
                onClick={onNext}
                style={{
                  width: '100%',
                  padding: '18px',
                  borderRadius: 16,
                  border: 'none',
                  cursor: 'pointer',
                  background: '#1a1a2e',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: 17,
                  fontFamily: BODY,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={e =>
                  ((e.currentTarget as HTMLElement).style.background = '#22223a')
                }
                onMouseLeave={e =>
                  ((e.currentTarget as HTMLElement).style.background = '#1a1a2e')
                }
              >
                {isLast ? '✓ VER RESULTADOS' : 'SIGUIENTE →'}
              </button>
            </motion.div>
          )}
        </div>
      </div>

      {/* Número de página fuente */}
      {question.sourcePage && (
        <div
          style={{
            textAlign: 'center',
            marginTop: 10,
            fontSize: 12,
            color: '#333',
            fontFamily: BODY,
          }}
        >
          📄 Pág. {question.sourcePage}{' '}
          {question.sourceMaterialName && `· ${question.sourceMaterialName}`}
        </div>
      )}
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

  const pct =
    evaluation?.porcentaje ??
    (correct ? 100 : 0);

  const state =
    pct >= 85
      ? 'correct'
      : pct >= 50
      ? 'partial'
      : 'wrong';

  const title =
    state === 'correct'
      ? '🟢 CORRECTO'
      : state === 'partial'
      ? '🟡 MEDIO CORRECTO'
      : '🔴 INCORRECTO';

  const color =
    state === 'correct'
      ? '#16a34a'
      : state === 'partial'
      ? '#f59e0b'
      : '#dc2626';

  const bg =
    state === 'correct'
      ? '#ecfdf5'
      : state === 'partial'
      ? '#fffbeb'
      : '#fef2f2';

  return (
    <div
      id="quiz-feedback"
      style={{
        background:bg,
        border:`2px solid ${color}`,
        borderRadius:18,
        padding:20,
        display:'flex',
        flexDirection:'column',
        gap:12,
        color:'#111',
      }}
    >

      <div
        style={{
          display:'flex',
          justifyContent:'space-between',
          alignItems:'center',
          fontWeight:900,
          color,
          fontSize:18,
        }}
      >
        <span>{title}</span>

        <span
          style={{
            padding:'4px 12px',
            borderRadius:999,
            background:'#fff',
            border:`2px solid ${color}`
          }}
        >
          {pct}%
        </span>
      </div>

      <div
        style={{
          height:8,
          borderRadius:999,
          overflow:'hidden',
          background:'rgba(0,0,0,.08)'
        }}
      >
        <div
          style={{
            width:`${pct}%`,
            height:'100%',
            background:color
          }}
        />
      </div>

      <div>
        <strong>Tu respuesta:</strong>{' '}
        {question.type === 'matching'
          ? (question.pairs || []).map((p: any, i: number) => {
              const chosen = (question.pairs || [])[userAnswer?.[i]]?.right || 'sin conectar';
              return `${p.left} → ${chosen}`;
            }).join(' | ')
          : Array.isArray(userAnswer)
          ? userAnswer.map((i: number) => `${String.fromCharCode(65 + i)}. ${question.options?.[i] ?? i}`).join(', ')
          : String(userAnswer ?? '')}
      </div>

      {evaluation?.respuestaCorrecta && (
        <div>
          <strong>
          Respuesta esperada:
          </strong>{' '}
          {evaluation.respuestaCorrecta}
        </div>
      )}

      {evaluation?.analisis && (
        <div>
          <strong>
          Análisis:
          </strong>{' '}
          {evaluation.analisis}
        </div>
      )}

      {evaluation?.explicacion && (
        <div>
          <strong>
          Por qué:
          </strong>{' '}
          {evaluation.explicacion}
        </div>
      )}

      {evaluation?.consejo && (
        <div>
          💡 {evaluation.consejo}
        </div>
      )}

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
  const borderColor = correct
    ? '#4caf50'
    : wrong
    ? '#f44336'
    : selected
    ? themeColor
    : 'rgba(0,0,0,0.12)';
  const bg = correct
    ? '#e8f5e9'
    : wrong
    ? '#ffebee'
    : selected
    ? `${themeColor}15`
    : '#fff';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '15px 18px',
        borderRadius: 14,
        border: `2px solid ${borderColor}`,
        background: bg,
        cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left',
        transition: 'all 0.18s',
        transform: selected && !disabled ? 'scale(1.015)' : 'scale(1)',
        boxShadow: correct
          ? '0 4px 16px rgba(76,175,80,0.3)'
          : wrong
          ? '0 4px 16px rgba(244,67,54,0.3)'
          : selected
          ? `0 4px 16px ${themeColor}33`
          : 'none',
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: square ? 6 : '50%',
          border: `2px solid ${borderColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 900,
          color: correct ? '#2e7d32' : wrong ? '#c62828' : selected ? themeColor : '#999',
          flexShrink: 0,
          fontFamily: BODY,
          background: selected || correct || wrong ? 'rgba(0,0,0,0.04)' : 'transparent',
        }}
      >
        {correct ? '✓' : wrong ? '✗' : label}
      </div>
      <span
        style={{
          fontSize: 15,
          fontWeight: selected || correct ? 700 : 500,
          color: '#111',
          fontFamily: BODY,
          lineHeight: 1.4,
        }}
      >
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
