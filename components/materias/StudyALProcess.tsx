"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useMultiContent } from "../../lib/materials/useContent";
import {
  saveMaterialMastery,
  generateStudyBlocks,
  calculateMasterySnapshot,
  buildMasteryContext,
  processEvent,
} from "../../lib/masteryEngine";
import type { MaterialMastery, ToolId } from "../../lib/masteryEngine";
import {
  generateAdaptiveProgram,
  fetchAndBuildBlueprint,
  enrichStrategyWhyWithTopics,
  loadLearningMemory,
  saveLearningMemory,
  updateLearningMemory,
  createEmptyLearningMemory,
} from "../../lib/adaptive";
import {
  buildUserProfile,
  cacheUserProfile,
  loadCachedUserProfile,
  buildProfileContext,
} from "../../lib/adaptive/userProfile";
import type { UserProfile } from "../../lib/adaptive/userProfile";
import type { MaterialBlueprint } from "../../lib/adaptive";

import {
  updateAdaptiveProgramAfterSession,
  getLatestStrategyChangeMessage,
} from "../../lib/adaptive";
import type {
  AdaptiveProgram,
  AdaptiveProgramSetup as AdaptiveProgramSetupType,
  LearningMemory,
} from "../../lib/adaptive";
import { getCurrentSession, getNextAvailableSession } from "../../lib/adaptive";
import AdaptiveProgramSetupModal from "./adaptive/AdaptiveProgramSetup";
import AdaptiveProgramHome from "./adaptive/AdaptiveProgramHome";
import AdaptiveSessionRunner from "./adaptive/AdaptiveSessionRunner";
import AdaptiveSessionComplete from "./adaptive/AdaptiveSessionComplete";
import AdaptiveDebugPanel from "./adaptive/AdaptiveDebugPanel";
import StudyALBook from "./adaptive/book/StudyALBook";
import BookPreparation from "./adaptive/book/BookPreparation";
import AdaptiveSessionV2 from "./adaptive/book/AdaptiveSessionV2";
import ProcessStyleSelector from "./adaptive/book/ProcessStyleSelector";
import type { ProcessStyle } from "./adaptive/book/ProcessStyleSelector";
import { useSyncAdaptiveState } from "../../hooks/useSyncAdaptiveState";
import { upsertSession } from "../../lib/studySessions";

function getDocEmoji(tipo: string) {
  if (tipo === "pdf") return "📄";
  if (tipo === "imagen") return "🖼️";
  if (tipo === "word") return "📃";
  if (tipo === "ppt") return "📊";
  if (tipo === "youtube") return "▶️";
  return "📁";
}

function getMaterialId(m: any) {
  return String(m?.materialId || m?.id || m?.nombre || "").trim();
}

const EXAM_DATE_LABELS: Record<string, string> = {
  today: "Hoy",
  tomorrow: "Mañana",
  this_week: "Esta semana",
  custom: "Fecha personalizada",
  just_studying: "Solo estudiando",
};

interface Props {
  materiales: any[];
  temaId?: string;
  enfoque?: string;
  onClose: () => void;
  onOpenCoach?: () => void;
  onOpenFlashcards: () => void;
  onOpenQuiz: () => void;
  onOpenRepasar?: () => void;
  onOpenAnalisis?: () => void;
  onOpenAlai?: () => void;
  onOpenExam?: () => void;
  onOpenStudyMap?: () => void;
  onOpenCheatCodes?: () => void;
  onComingSoon: (label: string) => void;
  masterySnapshot?: any;
  masteryState?: any;
  initialMode?: 'free' | 'adaptive';
}

// ── Configuración del círculo (modo libre) ───────────────────────
const VB_W = 800;
const VB_H = 680;
const CIRCLE = { cx: 400, cy: 340, r: 215 };

function polarToXY(angleDeg: number, radius = CIRCLE.r) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: CIRCLE.cx + Math.cos(rad) * radius,
    y: CIRCLE.cy + Math.sin(rad) * radius,
  };
}

function describeArc(startAngle: number, endAngle: number, radius = CIRCLE.r) {
  const start = polarToXY(endAngle, radius);
  const end = polarToXY(startAngle, radius);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

// ── Tipo de vista adaptativa ─────────────────────────────────────
type AdaptiveView = 'home' | 'running' | 'complete' | 'book' | 'style_selector'

export default function StudyALProcess({
  materiales,
  temaId,
  enfoque,
  onClose,
  onOpenCoach,
  masterySnapshot,
  masteryState,
  onOpenFlashcards,
  onOpenQuiz,
  onOpenRepasar,
  onOpenAnalisis,
  onOpenAlai,
  onOpenExam,
  onOpenStudyMap,
  onOpenCheatCodes,
  onComingSoon,
  initialMode,
}: Props) {
  const [ready, setReady] = useState(false);
  const [completed, setCompleted] = useState<Record<string, boolean>>({});

  // ── Modo del proceso ─────────────────────────────────────────────
  const [setupOpen, setSetupOpen] = useState(false);
  // Ref para guardar el initialMode original — nunca debe ser pisado por re-renders
  const initialModeRef = useRef<'free' | 'adaptive' | undefined>(initialMode);
  // Solo actualizar si viene un valor nuevo no-nulo
  if (initialMode && initialModeRef.current !== initialMode) {
    initialModeRef.current = initialMode;
  }

  const [processMode, setProcessMode] = useState<'guided' | 'free' | 'adaptive'>(
    (() => {
      // initialMode tiene prioridad absoluta
      if (initialModeRef.current) return initialModeRef.current;
      const m = masteryState?.processMode;
      if (m === 'guided') return 'adaptive';
      return (m as 'free' | 'adaptive') || 'free';
    })()
  );
  const [targetScore, setTargetScore] = useState<number>(
    (masteryState as any)?.targetScore || 80
  );
  const [examDate, setExamDate] = useState<string | null>(
    (masteryState as any)?.examDate || null
  );
  const [examDateCustom, setExamDateCustom] = useState<string>(
    (masteryState as any)?.examDateCustom || ''
  );

  // ── Estado del modo adaptativo ───────────────────────────────────
  const [adaptiveProgram, setAdaptiveProgram] = useState<AdaptiveProgram | null>(() => {
    // Intentar desde masteryState prop
    if ((masteryState as any)?.adaptiveProgram) return (masteryState as any).adaptiveProgram;
    // Intentar desde localStorage
    if (typeof window !== 'undefined') {
      try {
        const ids = (materiales || []).map((m: any) => String(m?.materialId || m?.id || m?.nombre || '').trim()).filter(Boolean).sort().join('-');
        const key = 'studyal_mastery_v2_' + ids;
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.adaptiveProgram) return parsed.adaptiveProgram;
        }
      } catch {}
    }
    return null;
  });
  const [materialBlueprint, setMaterialBlueprint] = useState<MaterialBlueprint | null>(
    (masteryState as any)?.materialBlueprint || null
  );
  const [isBuildingBlueprint, setIsBuildingBlueprint] = useState(false);
  const [lastApiPayload, setLastApiPayload] = useState<Record<string, any> | null>(null);
  const [learningMemory, setLearningMemory] = useState<LearningMemory | null>(null);
  const [userProfileData, setUserProfileData] = useState<UserProfile | null>(null);
  const [processStyle, setProcessStyle] = useState<ProcessStyle | null>(() => {
    // Intentar desde masteryState prop
    if ((masteryState as any)?.processStyle) return (masteryState as any).processStyle;
    // Intentar desde localStorage
    if (typeof window !== 'undefined') {
      try {
        const ids = (materiales || []).map((m: any) => String(m?.materialId || m?.id || m?.nombre || '').trim()).filter(Boolean).sort().join('-');
        const key = 'studyal_mastery_v2_' + ids;
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.processStyle) return parsed.processStyle;
        }
      } catch {}
    }
    return null;
  });
  const [showStyleSelector, setShowStyleSelector] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const { saveAdaptiveState, loadAdaptiveState, forceSyncNow } = useSyncAdaptiveState();
  const [adaptiveView, setAdaptiveView] = useState<AdaptiveView>('home');
  const [sessionDomainBefore, setSessionDomainBefore] = useState(0);
  const [sessionDomainAfter, setSessionDomainAfter] = useState(0);
  const [strategyChangeMessage, setStrategyChangeMessage] = useState<string | null>(null);
  const [localMasteryState, setLocalMasteryState] = useState<MaterialMastery | null>(masteryState || null);
  const [localMasterySnapshot, setLocalMasterySnapshot] = useState<any>(masterySnapshot || null);

  const sessionKey = useMemo(() => {
    const ids = materiales.map(getMaterialId).filter(Boolean).sort().join("-");
    return `studyal_process_v4_${ids || "empty"}`;
  }, [materiales]);

  const { texts: contenidos, status: contentStatus } = useMultiContent(
    materiales.map((m: any) => ({
      id: m.id,
      contenido: m.contenido,
      kind: m.kind ?? m.tipo,
      materialId: m.materialId,
    })),
    true,
  );

  const materialContent = useMemo(
    () => Object.values(contenidos || {}).join("\n\n").slice(0, 12000),
    [contenidos]
  );

  const totalChars = Object.values(contenidos || {}).join("").length;
  const estimatedPages = Math.max(1, Math.round(totalChars / 1600));

  const masteryContext = useMemo(
    () => buildMasteryContext(localMasteryState || null),
    [localMasteryState]
  );

  const currentDomain = useMemo(() => {
    if (typeof localMasterySnapshot?.overallMastery === 'number') {
      return localMasterySnapshot.overallMastery;
    }
    return 0;
  }, [localMasterySnapshot]);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    setLocalMasteryState(masteryState || null);
    setLocalMasterySnapshot(masterySnapshot || null);
  }, [
    masteryState,
    masterySnapshot,
    masteryState?.lastUpdated,
    (masteryState as any)?.freeModeProgress?.repasar,
    (masteryState as any)?.freeModeProgress?.analisis,
    (masteryState as any)?.freeModeProgress?.studymap,
    (masteryState as any)?.freeModeProgress?.truquitos,
    (masteryState as any)?.freeModeProgress?.flashcards,
    (masteryState as any)?.freeModeProgress?.quiz,
    (masteryState as any)?.freeModeProgress?.examen,
    (masteryState as any)?.freeModeProgress?.alai,
  ]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(sessionKey);
      if (raw) setCompleted(JSON.parse(raw));
    } catch {}
  }, [sessionKey]);

  // Serializar dependencias profundas para que React detecte cambios
  const toolsCompletedKey = JSON.stringify(localMasteryState?.toolsCompleted || {});
  const freeProgressKey = JSON.stringify((localMasteryState as any)?.freeModeProgress || {});

  useEffect(() => {
    if (!localMasteryState) return;
    const fromMastery: Record<string, boolean> = {};

    // 1. Marcar desde toolsCompleted
    Object.entries(localMasteryState.toolsCompleted || {}).forEach(([k, v]) => {
      if (v) fromMastery[k] = true;
    });

    // 2. En modo libre: marcar las que tienen freeModeProgress > 0
    const freeProgress = (localMasteryState as any).freeModeProgress;
    if (freeProgress) {
      Object.entries(freeProgress).forEach(([k, v]) => {
        if (typeof v === 'number' && v > 0) fromMastery[k] = true;
      });
    }

    setCompleted(fromMastery);
    try {
      localStorage.setItem(sessionKey, JSON.stringify(fromMastery));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolsCompletedKey, freeProgressKey, sessionKey]);

  useEffect(() => {
    const m: any = masteryState || null;
    if (!m) return;

    // initialModeRef SIEMPRE gana — protegido contra re-renders
    const effectiveInitialMode = initialModeRef.current;
    const mode = effectiveInitialMode
      ? effectiveInitialMode
      : m.processMode === 'guided'
      ? 'adaptive'
      : (m.processMode || 'free');

    setProcessMode(mode);
    setTargetScore(m.targetScore || 80);
    setExamDate(m.examDate || null);
    setExamDateCustom(m.examDateCustom || '');
    // Verificar que el adaptiveProgram guardado corresponde a los materiales actuales
    const savedProgram = m.adaptiveProgram || null
    const currentMatIds = (materiales || [])
      .map((mat: any) => String(mat?.materialId || mat?.id || ''))
      .filter(Boolean)
      .sort()
      .join('|')
    const programMatIds = savedProgram
      ? (savedProgram.materialIds || []).map(String).sort().join('|')
      : ''

    // Solo restaurar si los materialIds coinciden exactamente
    const programMatchesMaterials = currentMatIds && programMatIds && currentMatIds === programMatIds
    const programToRestore = programMatchesMaterials ? savedProgram : null

    if (!programMatchesMaterials && savedProgram) {
      console.log('🚫 [Restore] adaptiveProgram descartado — materiales distintos:', {
        current: currentMatIds,
        saved: programMatIds,
      })
    }

    setAdaptiveProgram(programToRestore);
    // Restaurar processStyle si existe
    const savedStyle = (m as any).processStyle;
    console.log('🔄 [Restore] adaptiveProgram:', !!programToRestore, '| processMode:', mode, '| processStyle:', savedStyle);
    if (savedStyle && savedStyle !== processStyle) {
      setProcessStyle(savedStyle);
    }
    // Si es modo adaptive con libro y hay programa válido, abrir libro directo
    if (mode === 'adaptive' && (savedStyle === 'book' || processStyle === 'book') && programToRestore) {
      setAdaptiveView('book');
    }

    // Persistir usando initialModeRef — no causa loop
    if (initialModeRef.current && m.sessionKey) {
      const updated: MaterialMastery = {
        ...m,
        processMode: initialModeRef.current,
        lastUpdated: Date.now(),
      };
      saveMaterialMastery(updated);
    }

    // El modo libre ya no abre setup nunca
    setSetupOpen(false);
  }, [masteryState?.sessionKey, initialMode]);

  // ── Persistencia local del mastery ───────────────────────────────
  const persistMasteryState = useCallback((nextMastery: MaterialMastery) => {
    saveMaterialMastery(nextMastery);
    setLocalMasteryState(nextMastery);
    try {
      setLocalMasterySnapshot(calculateMasterySnapshot(nextMastery));
    } catch {
      setLocalMasterySnapshot(null);
    }
  }, []);

  // ── Guardar programa adaptativo ──────────────────────────────────
  const saveAdaptiveProgram = useCallback((program: AdaptiveProgram) => {
    setAdaptiveProgram(program);

    const baseMastery = (localMasteryState || masteryState) as MaterialMastery | null;
    if (baseMastery?.sessionKey) {
      const updated: MaterialMastery = {
        ...baseMastery,
        processMode: 'adaptive',
        adaptiveProgram: program,
        lastUpdated: Date.now(),
      };
      persistMasteryState(updated);
    }
  }, [localMasteryState, masteryState, persistMasteryState]);

  // ── Handlers modo adaptativo ─────────────────────────────────────
  // Guardar el setup pendiente mientras se elige estilo
  const [pendingSetup, setPendingSetup] = useState<AdaptiveProgramSetupType | null>(null);

  const handleSetupComplete = useCallback((setup: AdaptiveProgramSetupType) => {
    // SOLO guardar el setup y mostrar el selector de estilo
    // NO generar nada todavía
    setPendingSetup(setup);

    const savedStyle = processStyle || (localMasteryState as any)?.processStyle;
    if (!savedStyle) {
      setShowStyleSelector(true);
    } else {
      // Ya tiene estilo guardado, generar directo
      if (!processStyle) setProcessStyle(savedStyle);
      generateProgramWithStyle(setup, savedStyle);
    }
  }, [processStyle, localMasteryState]);

  // Generar blueprint + programa DESPUÉS de elegir estilo
  const generateProgramWithStyle = useCallback(async (
    setup: AdaptiveProgramSetupType,
    style: ProcessStyle,
  ) => {
    const baseMastery = (localMasteryState || masteryState) as MaterialMastery | null;

    console.log('🔵 [generate] INICIO | style:', style);
    // FORZAR null para que el render muestre BookPreparation
    setAdaptiveProgram(null);
    setIsBuildingBlueprint(true);
    setPendingSetup(null);
    console.log('🔵 [generate] States reseteados');

    // SIEMPRE regenerar blueprint — el viejo puede ser de otro material
    let blueprint: MaterialBlueprint | null = null;

    if (materialContent && materialContent.trim().length > 100) {
      try {
        const materialTitle =
          materiales?.[0]?.nombre ||
          materiales?.[0]?.name ||
          baseMastery?.materialName ||
          'Material';

        const materialId =
          baseMastery?.materialId ||
          materiales?.[0]?.materialId ||
          materiales?.[0]?.id ||
          'mat_default';

        const loadedLearningMemory =
          loadLearningMemory(materialId) || createEmptyLearningMemory(materialId);
        setLearningMemory(loadedLearningMemory);

        blueprint = await fetchAndBuildBlueprint({
          materialId,
          materialTitle,
          materialContent,
        });

        setMaterialBlueprint(blueprint);
        console.log('[StudyAL] Blueprint construido:', blueprint.topics.length, 'temas');
      } catch (err) {
        console.error('[StudyAL] Error construyendo blueprint:', err);
        blueprint = null;
      }
    }

    // FASE 2: Generar programa (ahora async: ALAI diseña la estructura)
    let program: AdaptiveProgram
    try {
      program = await generateAdaptiveProgram(
        baseMastery || null,
        setup,
        blueprint,
        learningMemory || null,
        userProfileData || null,
      );
    } catch (err: any) {
      console.error('[StudyALProcess] generateAdaptiveProgram falló:', err?.message)
      setIsBuildingBlueprint(false)
      setAdaptiveProgram(null)
      // Mostrar error visible al usuario
      alert('ALAI está ocupado en este momento. Intenta generar tu programa de nuevo en unos segundos.')
      return
    }

    // FASE 3: Persistir
    if (baseMastery?.sessionKey) {
      const updated: MaterialMastery = {
        ...baseMastery,
        processMode: 'adaptive',
        targetScore: setup.targetScore,
        dailyMinutes: setup.dailyMinutes,
        adaptiveProgram: program,
        materialBlueprint: blueprint,
        lastUpdated: Date.now(),
      } as any;
      (updated as any).processStyle = style;
      persistMasteryState(updated);
    }

    // Guardar sesión activa COMPLETA para que TemaView la reanude sin perder progreso
    if (temaId) {
      const matIds = materiales.map((m: any) => m?.materialId || m?.id).filter(Boolean);
      upsertSession({
        temaId,
        enfoque: (enfoque || 'teorico') as any,
        studyMode: 'adaptive',
        processMode: 'adaptive',
        materialIds: matIds,
        adaptiveProgram: program,
        processStyle: style,
        targetScore,
        examDate: examDate || undefined,
        examDateCustom: examDateCustom || undefined,
        materialBlueprint,
        currentPhase: 'adaptive_active',
      });
      console.log('💾 Sesión adaptativa COMPLETA guardada — program sessions:', program?.sessions?.length, '| style:', style);
    }

    // FASE 4: AHORA SÍ activar el libro (todo está listo)
    console.log('🟢 [generate] FIN - activando libro con', program?.sessions?.length, 'sesiones');
    setAdaptiveProgram(program);
    setIsBuildingBlueprint(false);
    setAdaptiveView(style === 'book' ? 'book' : 'home');
  }, [
    localMasteryState,
    masteryState,
    persistMasteryState,
    materialBlueprint,
    materialContent,
    materiales,
    learningMemory,
    userProfileData,
  ]);

  const handleStartSession = useCallback(() => {
    // ── Validación dura: no iniciar sin material listo ────
    if (!materialContent || materialContent.trim().length < 100) {
      alert('El material todavía se está cargando. Espera un momento.');
      return;
    }
    if (!materialBlueprint) {
      alert('ALAI todavía está analizando tu material. Esto toma unos segundos.');
      return;
    }
    if (isBuildingBlueprint) {
      alert('ALAI está terminando de preparar tu programa. Un momento...');
      return;
    }
    if (!adaptiveProgram || adaptiveProgram.sessions.length === 0) {
      alert('No hay sesiones disponibles. Refresca la página.');
      return;
    }

    setSessionDomainBefore(currentDomain);
    setSessionStartedAt(Date.now());
    setAdaptiveView('running');
  }, [currentDomain, materialContent, materialBlueprint, isBuildingBlueprint, adaptiveProgram]);

  // ── Debug: trackear payload de cada endpoint ─────────────────
  const trackApiCall = useCallback((endpoint: string, payload: Record<string, any>) => {
    if (process.env.NODE_ENV !== 'development') return
    setLastApiPayload({
      _endpoint: endpoint,
      _timestamp: Date.now(),
      _charsEnviados: JSON.stringify(payload).length,
      ...payload,
    })
  }, [])

  const handleSessionComplete = useCallback((result: {
    domainGain: number;
    conceptsImproved: string[];
    stepResults: Array<{ stepId: string; score?: number; correct?: boolean }>;
  }) => {
    if (!adaptiveProgram) return;

    const baseMastery = (localMasteryState || masteryState) as MaterialMastery | null;
    const currentIdx = adaptiveProgram.currentSessionIndex;
    const liveSession = adaptiveProgram.sessions[currentIdx];

    const engineToTool: Record<string, ToolId> = {
      analisis: 'analisis',
      repasar: 'repasar',
      flashcards: 'flashcards',
      quiz: 'quiz',
      examen: 'examen',
      alai: 'alai',
      truquitos: 'truquitos',
      studymap: 'studymap',
    };

    let updatedMastery = baseMastery;

    if (updatedMastery && liveSession) {
      // ── Conceptos del topic (fuente de verdad del blueprint) ──
      const topicConcepts = liveSession.targetConcepts ?? []
      const fallbackConcepts =
        masteryContext?.weakConcepts?.slice(0, 3) ||
        masteryContext?.criticalConcepts?.slice(0, 2) ||
        []
      const identifiedConcepts = topicConcepts.length > 0
        ? topicConcepts.slice(0, 4)
        : fallbackConcepts

      // ── NOTA: liveSession.steps puede estar vacío (steps se generan on-demand) ──
      // En ese caso, procesamos los stepResults directamente sin buscar en steps
      const hasLiveSteps = liveSession.steps && liveSession.steps.length > 0

      for (const stepResult of result.stepResults) {
        const score = stepResult.score ?? 0
        if (score < 5) continue // ignorar scores insignificantes

        // Intentar encontrar el step en liveSession.steps
        const step = hasLiveSteps
          ? liveSession.steps.find((s) => s.id === stepResult.stepId)
          : null

        // Si no hay step (steps vacíos), inferir tipo desde el stepId
        // AdaptiveSessionV2 genera IDs como "closing_xxx", "reex_xxx", "req_xxx"
        const inferredType = step?.type || (() => {
          const id = stepResult.stepId || ''
          if (id.startsWith('reex_')) return 'explain'
          if (id.startsWith('req_')) return 'micro_quiz'
          if (id.startsWith('closing_')) return 'micro_quiz'
          if (id.startsWith('practice_quiz')) return 'micro_quiz'
          if (id.startsWith('practice_flash')) return 'flashcards'
          // Inferir por score: scores altos sin step → evidencia de quiz/recall
          if (score >= 60) return 'micro_quiz'
          return 'explain'
        })()

        const inferredEngine = step?.engine || (() => {
          if (inferredType === 'micro_quiz' || inferredType === 'mini_exam') return 'quiz'
          if (inferredType === 'active_recall') return 'alai'
          if (inferredType === 'flashcards') return 'flashcards'
          return 'analisis'
        })()

        const isEvidenceStep = step?.evidenceRequired ?? (
          // Sin step (steps vacíos): inferir por tipo
          // recall, quiz, recall activo = evidencia fuerte
          // explain, chat = solo exposición
          inferredType === 'micro_quiz' || 
          inferredType === 'mini_exam' ||
          inferredType === 'active_recall' ||
          inferredType === 'recall' ||
          (inferredType === 'explain' && score >= 80) // explain con score alto = recall implícito
        )

        if (!isEvidenceStep && score === 0) continue

        const tool = engineToTool[inferredEngine] || 'alai'
        // Recall activo vale más que quiz — demuestra comprensión real
        const scoreMultiplier = isEvidenceStep
          ? (inferredType === 'active_recall' || inferredType === 'recall' ? 1.2 : 1.0)
          : 0.1
        const adjustedScore = Math.min(100, Math.round(score * scoreMultiplier))
        if (adjustedScore < 8) continue

        const evidenceType = (
          inferredType === 'active_recall' ? 'recall' :
          inferredType === 'repair' ? 'correction' :
          inferredType === 'micro_quiz' || inferredType === 'mini_exam' ? 'application' :
          inferredType === 'explain' ? 'explanation' :
          'recall'
        ) as 'recall' | 'explanation' | 'application' | 'exam' | 'correction'

        updatedMastery = processEvent(updatedMastery, {
          tool,
          materialId: updatedMastery.materialId,
          sessionKey: updatedMastery.sessionKey,
          timestamp: Date.now(),
          score: adjustedScore,
          correct: stepResult.correct,
          confidence: stepResult.correct ? 80 : 35,
          topicId: liveSession.topicId,
          topicTitle: liveSession.topicTitle,
          sourcePages: liveSession.sourcePages,
          evidenceType,
          evidenceStrength: (
            adjustedScore >= 80 ? 'strong' :
            adjustedScore >= 55 ? 'medium' : 'weak'
          ) as 'weak' | 'medium' | 'strong',
          conceptsIdentified: identifiedConcepts,
          explanationQuality:
            inferredType === 'active_recall' || inferredType === 'repair'
              ? adjustedScore
              : undefined,
        })

        // ── Enriquecer conceptos con topicId/topicTitle del blueprint ──
        if (liveSession.topicId && liveSession.topicTitle && updatedMastery) {
          updatedMastery = {
            ...updatedMastery,
            concepts: updatedMastery.concepts.map(c => {
              if (identifiedConcepts.some(ic =>
                ic.toLowerCase().includes(c.name.toLowerCase().slice(0, 8)) ||
                c.name.toLowerCase().includes(ic.toLowerCase().slice(0, 8))
              )) {
                return {
                  ...c,
                  topicId: c.topicId || liveSession.topicId,
                  topicTitle: c.topicTitle || liveSession.topicTitle,
                  sourcePages: c.sourcePages || liveSession.sourcePages,
                }
              }
              return c
            }),
          }
        }
      }

      // ── GARANTÍA: si no hubo ningún stepResult con score, usar domainGain directo ──
      // Esto asegura que el dominio SIEMPRE sube después de completar una sesión
      const hadAnyScore = result.stepResults.some(r => (r.score ?? 0) >= 40)
      if (!hadAnyScore && result.domainGain > 0) {
        // Aplicar el domainGain como un evento de recall genérico
        updatedMastery = processEvent(updatedMastery, {
          tool: 'quiz',
          materialId: updatedMastery.materialId,
          sessionKey: updatedMastery.sessionKey,
          timestamp: Date.now(),
          score: Math.min(100, result.domainGain * 8), // convertir gain a score
          correct: true,
          confidence: 65,
          topicId: liveSession.topicId,
          topicTitle: liveSession.topicTitle,
          sourcePages: liveSession.sourcePages,
          evidenceType: 'application' as const,
          evidenceStrength: 'medium' as const,
          conceptsIdentified: identifiedConcepts,
        })
      }
    }

    // Calcular nuevo dominio — garantizar que siempre sube
    // Calcular dominio nuevo — siempre debe subir al menos domainGain
    const minNewDomain = Math.min(100, currentDomain + result.domainGain)
    let newDomain = minNewDomain
    if (updatedMastery) {
      try {
        const nextSnapshot = calculateMasterySnapshot(updatedMastery)
        // Tomar el mayor: snapshot calculado vs domainGain mínimo garantizado
        newDomain = Math.max(nextSnapshot.overallMastery, minNewDomain)
        console.log('📈 [domain] antes:', currentDomain, '| gain:', result.domainGain, '| snapshot:', nextSnapshot.overallMastery, '| final:', newDomain)
      } catch {
        newDomain = minNewDomain
      }
    }

    setSessionDomainAfter(newDomain);

    // Conceptos que mejoraron: topic blueprint > runner result > weak fallback
    const sessionTargetConcepts = liveSession?.targetConcepts ?? [];
    const realConceptsImproved: string[] = result.conceptsImproved.length > 0
      ? result.conceptsImproved
      : sessionTargetConcepts.length > 0
        ? sessionTargetConcepts.slice(0, 4)
        : (masteryContext?.weakConcepts?.slice(0, 3) || [])

    // Conceptos todavía débiles
    const realConceptsStillWeak: string[] = (masteryContext?.criticalConcepts || [])
      .slice(0, 3)
      .filter((c: string) => !realConceptsImproved.includes(c))

    const updatedSessions = adaptiveProgram.sessions.map((s, i) => {
      if (i === currentIdx) {
        return {
          ...s,
          status: 'completed' as const,
          domainBefore: currentDomain,
          domainAfter: newDomain,
          conceptsImproved: realConceptsImproved,
          conceptsStillWeak: realConceptsStillWeak,
          completedAt: Date.now(),
        };
      }
      return s;
    });

    const programWithResults: AdaptiveProgram = {
      ...adaptiveProgram,
      sessions: updatedSessions,
    };

    const updatedProgram = updateAdaptiveProgramAfterSession(
      programWithResults,
      updatedMastery || null,
    );

    // ── Actualizar LearningMemory automáticamente ───────────────
    if (liveSession) {
      const materialIdForMemory =
        updatedMastery?.materialId ||
        baseMastery?.materialId ||
        'mat_default';

      let nextLearningMemory =
        learningMemory || createEmptyLearningMemory(materialIdForMemory);

      const timeSpentMs = sessionStartedAt
        ? Math.max(1000, Date.now() - sessionStartedAt)
        : Math.max(60000, (liveSession.estimatedMinutes || 15) * 60000);

      for (const stepResult of result.stepResults) {
        const step = liveSession.steps.find((s) => s.id === stepResult.stepId);
        if (!step) continue;

        nextLearningMemory = updateLearningMemory(nextLearningMemory, {
          sessionId: liveSession.id,
          timestamp: Date.now(),
          topicId: liveSession.topicId || 'unknown',
          purpose: liveSession.purpose,
          stepType: step.type,
          score: stepResult.score ?? 0,
          timeSpentMs: Math.round(timeSpentMs / Math.max(1, result.stepResults.length)),
          correct: !!stepResult.correct,
          wasFirstAttempt: true,
          hadToRepeat: (stepResult.score ?? 0) < 60,
        });
      }

      setLearningMemory(nextLearningMemory);
      saveLearningMemory(nextLearningMemory);
      setSessionStartedAt(null);

      // ── Sync multi-dispositivo ──────────────────────────────
      saveAdaptiveState({
        materialId: materialIdForMemory,
        learningMemory: nextLearningMemory,
        adaptiveProgram: updatedProgram,
        topicMastery: (localMasterySnapshot as any)?.topicMastery ?? [],
        updatedAt: Date.now(),
      });
    }

    setAdaptiveProgram(updatedProgram);

    // Capturar mensaje de cambio de estrategia si hubo
    const changeMsg = getLatestStrategyChangeMessage(updatedProgram);
    if (changeMsg) setStrategyChangeMessage(changeMsg);

    if (updatedMastery) {
      const masteryWithProgram: MaterialMastery = {
        ...updatedMastery,
        processMode: 'adaptive',
        adaptiveProgram: updatedProgram,
        lastUpdated: Date.now(),
      };
      persistMasteryState(masteryWithProgram);
    } else {
      saveAdaptiveProgram(updatedProgram);
    }

    setAdaptiveView(processStyle === 'book' ? 'book' : 'complete');
  }, [
    adaptiveProgram,
    currentDomain,
    localMasteryState,
    masteryState,
    masteryContext,
    persistMasteryState,
    saveAdaptiveProgram,
  ]);

  const handleSessionCompleteClose = useCallback(() => {
    setAdaptiveView(processStyle === 'book' ? 'book' : 'home');
    // Limpiar el mensaje después de mostrarlo una vez
    setTimeout(() => setStrategyChangeMessage(null), 5000);
  }, []);

  // ── Modo libre: herramientas ──────────────────────────────────────
  const markAndOpen = (id: string, action?: () => void) => {
    action?.();
  };

  const tools = useMemo(
    () => [
      {
        id: "repasar", n: "01", title: "Repasar", verb: "Entender",
        desc: "Comprende las ideas principales del material.",
        emoji: "📖", color: "var(--gold)", colorHex: "#d6b26f", tape: "#d6b26f", angle: 0,
        action: () => markAndOpen("repasar", () => onOpenRepasar?.()),
      },
      {
        id: "analisis", n: "02", title: "Análisis", verb: "Conectar",
        desc: "Conecta conceptos y descubre relaciones.",
        emoji: "🔬", color: "var(--blue)", colorHex: "#38bdf8", tape: "#38bdf8", angle: 45,
        action: () => markAndOpen("analisis", () => onOpenAnalisis?.()),
      },
      {
        id: "studymap", n: "03", title: "Study Map", verb: "Visualizar",
        desc: "Organiza el tema en un mapa visual completo.",
        emoji: "🗺️", color: "#22d3ee", colorHex: "#22d3ee", tape: "#22d3ee", angle: 90,
        action: () => markAndOpen("studymap", () => onOpenStudyMap?.()),
      },
      {
        id: "truquitos", n: "04", title: "Truquitos", verb: "Memorizar",
        desc: "Atajos mentales para que se te quede sin esfuerzo.",
        emoji: "🧠", color: "#a78bfa", colorHex: "#a78bfa", tape: "#a78bfa", angle: 135,
        action: () => markAndOpen("truquitos", () => onOpenCheatCodes?.()),
      },
      {
        id: "flashcards", n: "05", title: "Flashcards", verb: "Recordar",
        desc: "Convierte la información en memoria a largo plazo.",
        emoji: "🎴", color: "var(--pink)", colorHex: "#f472b6", tape: "#f472b6", angle: 180,
        action: () => markAndOpen("flashcards", onOpenFlashcards),
      },
      {
        id: "quiz", n: "06", title: "Quiz", verb: "Aplicar",
        desc: "Pon a prueba tu comprensión y refuerza lo aprendido.",
        emoji: "🎯", color: "#ef4444", colorHex: "#ef4444", tape: "#ef4444", angle: 225,
        action: () => markAndOpen("quiz", onOpenQuiz),
      },
      {
        id: "examen", n: "07", title: "Examen ALAI", verb: "Demostrar",
        desc: "Simulación real para medir tu dominio del tema.",
        emoji: "📝", color: "var(--red)", colorHex: "#8a120c", tape: "#8a120c", angle: 270,
        action: () => markAndOpen("examen", () => onOpenExam?.()),
      },
      {
        id: "alai", n: "08", title: "ALAI", verb: "Profundizar",
        desc: "Profundiza, pregunta y lleva tu aprendizaje al siguiente nivel.",
        emoji: "✨", color: "var(--gold)", colorHex: "#d6b26f", tape: "#d6b26f", angle: 315,
        action: () => markAndOpen("alai", () => onOpenAlai?.()),
      },
    ],
    [onOpenRepasar, onOpenAnalisis, onOpenStudyMap, onOpenCheatCodes,
     onOpenFlashcards, onOpenQuiz, onOpenExam, onOpenAlai]
  );

  const completedCount = tools.filter((t) => completed[t.id]).length;
  const progress = typeof localMasterySnapshot?.overallMastery === 'number'
    ? localMasterySnapshot.overallMastery
    : Math.round((completedCount / tools.length) * 100);

  const nextTool = localMasterySnapshot?.nextAction?.tool
    ? tools.find((t) => t.id === localMasterySnapshot.nextAction.tool) || tools.find((t) => !completed[t.id]) || tools[0]
    : tools.find((t) => !completed[t.id]) || tools[0];

  const studyBlocks = localMasterySnapshot
    ? generateStudyBlocks(localMasteryState as any || {} as any, localMasterySnapshot as any)
    : [];
  const currentBlock = studyBlocks.find(b => b.isNext) || null;
  const studyForecast = Array.isArray(localMasterySnapshot?.studyImpactForecast)
    ? localMasterySnapshot.studyImpactForecast : [];

  const ARC_SPAN = 40;
  const ARROW_RADIUS = CIRCLE.r + 140;
  const arrows = tools.map((tool, i) => {
    const next = tools[(i + 1) % tools.length];
    const startAngle = tool.angle + 16;
    const endAngle = next.angle - 16;
    const adjustedEnd = endAngle < startAngle ? endAngle + 360 : endAngle;
    const start = polarToXY(startAngle, ARROW_RADIUS);
    const end = polarToXY(adjustedEnd, ARROW_RADIUS);
    return {
      id: `arrow-${tool.id}`,
      fromColor: tool.colorHex,
      toColor: next.colorHex,
      start,
      end,
      active: !!(completed[tool.id] && completed[next.id]),
    };
  });

  const saveProcessSetup = () => {
    const nextExamDate = examDate || 'just_studying';
    if (nextExamDate === 'custom' && !examDateCustom) return;
    if (masteryState?.sessionKey) {
      const updated: any = {
        ...masteryState,
        processMode,
        targetScore,
        examDate: nextExamDate,
        examDateCustom: nextExamDate === 'custom' ? examDateCustom : null,
        lastUpdated: Date.now(),
      };
      saveMaterialMastery(updated);
    }
    setSetupOpen(false);
  };

  const examLabel = examDate === 'custom'
    ? (examDateCustom ? `Examen: ${examDateCustom}` : 'Fecha personalizada')
    : examDate ? (EXAM_DATE_LABELS[examDate] || 'Sin fecha') : 'Sin fecha';

  // ════════════════════════════════════════════════════════════════
  // RENDER — MODO ADAPTATIVO
  // ════════════════════════════════════════════════════════════════
  // ── AUTOSAVE: persistir adaptiveProgram en StudySession cuando cambia ──
  useEffect(() => {
    if (!temaId || processMode !== 'adaptive' || !adaptiveProgram) return;
    const t = setTimeout(() => {
      try {
        const matIds = (materiales || []).map((m: any) => m?.materialId || m?.id).filter(Boolean);
        if (!matIds.length) return;
        upsertSession({
          temaId,
          enfoque: (enfoque || 'teorico') as any,
          studyMode: 'adaptive',
          processMode: 'adaptive',
          materialIds: matIds,
          adaptiveProgram,
          processStyle: processStyle || undefined,
          targetScore,
          examDate: examDate || undefined,
          examDateCustom: examDateCustom || undefined,
          materialBlueprint: materialBlueprint || undefined,
          masterySnapshot: localMasterySnapshot || undefined,
          currentPhase: 'adaptive_active',
        });
        console.log('💾 [autosave] Sesión adaptive actualizada | currentSession:', adaptiveProgram?.currentSessionIndex);
      } catch (e) {
        console.warn('Error en autosave de sesión adaptive:', e);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [adaptiveProgram, processStyle, targetScore, examDate, examDateCustom, materialBlueprint, localMasterySnapshot, temaId, enfoque, materiales, processMode]);

  if (processMode === 'adaptive') {
    console.log('🟡 [RENDER] adaptive | adaptiveProgram:', !!adaptiveProgram, '| showStyleSelector:', showStyleSelector, '| pendingSetup:', !!pendingSetup, '| isBuildingBlueprint:', isBuildingBlueprint, '| adaptiveView:', adaptiveView);
    // Sin programa → mostrar setup O selector de estilo
    if (!adaptiveProgram) {
      // Si está mostrando el style selector después del setup
      if (showStyleSelector && pendingSetup) {
        return (
          <ProcessStyleSelector
            onSelect={(style) => {
              setProcessStyle(style);
              if (localMasteryState) {
                const updated = { ...localMasteryState, processStyle: style } as any;
                setLocalMasteryState(updated);
                saveMaterialMastery(updated);
              }
              console.log('🟣 [Selector] Estilo elegido:', style, '| pendingSetup:', !!pendingSetup);
              setShowStyleSelector(false);
              generateProgramWithStyle(pendingSetup, style);
            }}
          />
        );
      }

      // Si está generando (después de elegir estilo, antes de tener programa)
      if (isBuildingBlueprint || pendingSetup) {
        const stage: 'analyzing' | 'designing' | 'ready' =
          !materialBlueprint ? 'analyzing' :
          !adaptiveProgram ? 'designing' :
          'ready';
        return (
          <BookPreparation
            stage={stage}
            topicsCount={materialBlueprint?.topics?.length}
            sessionsCount={adaptiveProgram?.sessions?.length}
          />
        );
      }

      // Default: mostrar setup
      return (
        <AdaptiveProgramSetupModal
          onComplete={handleSetupComplete}
          onCancel={onClose}
        />
      );
    }

    const currentSession = getCurrentSession(adaptiveProgram);
    const nextSession = adaptiveView === 'complete'
      ? (adaptiveProgram.sessions[adaptiveProgram.currentSessionIndex] || null)
      : (adaptiveProgram.sessions[adaptiveProgram.currentSessionIndex + 1] || null);

    if (adaptiveView === 'running' && currentSession) {
      const useBookStyle = processStyle === 'book';
      const SessionComponent = useBookStyle ? AdaptiveSessionV2 : AdaptiveSessionRunner;

      // Enriquecer masteryContext con datos que el componente de sesión necesita
      const enrichedMasteryContext = {
        ...(masteryContext || {}),
        // Perfil del usuario para personalizar explicaciones
        userProfile: userProfileData || (masteryContext as any)?.userProfile || null,
        // Blueprint para acceder a topics y conceptos reales
        materialBlueprint: materialBlueprint || (masteryContext as any)?.materialBlueprint || null,
        // Programa completo para saber en qué sesión vamos
        adaptiveProgram: adaptiveProgram || null,
        // Setup del programa
        setup: adaptiveProgram?.setup || null,
        sessionLength: adaptiveProgram?.setup?.sessionLength || 'medium',
        // LearningMemory para adaptar estilo
        learningMemory: learningMemory || null,
        // Título del material
        materialTitle: materiales?.[0]?.nombre || materiales?.[0]?.name || 'Material',
      }

      return (
        <SessionComponent
          session={currentSession}
          materialContent={materialContent}
          masteryContext={enrichedMasteryContext}
          onSessionComplete={handleSessionComplete}
          onClose={() => setAdaptiveView(useBookStyle ? 'book' : 'home')}
        />
      );
    }

    // Sesión completada
    if (adaptiveView === 'complete') {
      const completedSession = adaptiveProgram.sessions[adaptiveProgram.currentSessionIndex - 1]
        || adaptiveProgram.sessions[0];
      return (
        <AdaptiveSessionComplete
          session={completedSession}
          domainBefore={sessionDomainBefore}
          domainAfter={sessionDomainAfter}
          nextSession={nextSession}
          onContinue={handleSessionCompleteClose}
        />
      );
    }

    // Home del programa
    return (
      <>
        {process.env.NODE_ENV === 'development' && (
          <AdaptiveDebugPanel
            program={adaptiveProgram}
            materialContent={materialContent}
            masteryState={localMasteryState}
            masterySnapshot={localMasterySnapshot}
            materialBlueprint={materialBlueprint}
            isBuildingBlueprint={isBuildingBlueprint}
            lastApiPayload={lastApiPayload}
            learningMemory={learningMemory}
          />
        )}
        {/* Style Selector — primera vez */}

        {/* Book View — solo cuando TODO está listo */}
        {adaptiveView === 'book' && (() => {
          const materialReady = !!(materialContent && materialContent.trim().length >= 100);
          const blueprintReady = !!materialBlueprint && !isBuildingBlueprint;
          const programReady = !!(adaptiveProgram && adaptiveProgram.sessions && adaptiveProgram.sessions.length > 0);
          const fullyReady = materialReady && blueprintReady && programReady;

          // Si no está listo, mostrar pantalla de preparación
          if (!fullyReady) {
            const stage: 'analyzing' | 'designing' | 'ready' =
              !materialReady || isBuildingBlueprint ? 'analyzing' :
              !programReady ? 'designing' :
              'ready';

            return (
              <BookPreparation
                stage={stage}
                topicsCount={materialBlueprint?.topics?.length}
                sessionsCount={adaptiveProgram?.sessions?.length}
              />
            );
          }

          // Todo listo: mostrar el libro
          return (
          <StudyALBook
            program={adaptiveProgram!}
            materialTitle={
              materiales?.[0]?.nombre ||
              materiales?.[0]?.name ||
              'Tu Material'
            }
            onStartSession={handleStartSession}
            onClose={onClose}
          />
          );
        })()}

                {adaptiveView === 'home' && processStyle !== 'book' && (
<AdaptiveProgramHome
          program={(() => {
            // Enriquecer el strategy.why con topics reales antes de renderizar
            const topicMastery = (localMasterySnapshot as any)?.topicMastery ?? null
            if (adaptiveProgram.strategy && topicMastery) {
              const enrichedStrategy = enrichStrategyWhyWithTopics(adaptiveProgram.strategy, topicMastery)
              if (enrichedStrategy.why !== adaptiveProgram.strategy.why) {
                return { ...adaptiveProgram, strategy: enrichedStrategy }
              }
            }
            return adaptiveProgram
          })()}
          currentDomain={currentDomain}
          onStartSession={handleStartSession}
          onClose={onClose}
          strategyChangeMessage={strategyChangeMessage}
          topicMastery={(localMasterySnapshot as any)?.topicMastery ?? null}
        />
        )}

      </>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // RENDER — MODO LIBRE (igual que antes, sin cambios)
  // ════════════════════════════════════════════════════════════════
  return (
    <div className="sap-screen">
      <div className="sap-board-bg" />      <div className="sap-board-bg" />
      <div className="sap-board-grain" />

      <div className="sap-topbar">
        <button className="sap-back" onClick={onClose}>← volver al mapa</button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>

        </div>
      </div>

      <main className={`sap-canvas ${ready ? "ready" : ""}`}>
        <aside className="sap-left">
          <div className="sap-hero">
            <h1>The Study<span>AL</span> Process</h1>
            <svg width="260" height="12" viewBox="0 0 260 12" className="sap-hero-underline">
              <path d="M4 7 Q 70 2 130 6 T 256 5" stroke="var(--red)" strokeWidth="3" fill="none" strokeLinecap="round" />
            </svg>
            <p>Herramientas libres para dominar este material.</p>
          </div>

          <div className="sap-card">
            <h4>Material seleccionado</h4>
            <div className="sap-mat-icons">
              {materiales.slice(0, 3).map((m: any, i: number) => (
                <span key={m.id || i} className="sap-mat-chip">{getDocEmoji(m.tipo)}</span>
              ))}
              {materiales.length > 3 && (
                <span className="sap-mat-chip sap-mat-more">+{materiales.length - 3}</span>
              )}
            </div>
            <p className="sap-card-meta">
              {contentStatus === "loading" ? "extrayendo texto..." :
                `${estimatedPages} páginas · ${materiales.length} ${materiales.length === 1 ? "documento" : "documentos"}`}
            </p>
          </div>

          <div className="sap-card">
            <h4>Tu progreso general</h4>
            <div className="sap-donut-wrap">
              <svg viewBox="0 0 120 120" className="sap-donut">
                <circle cx="60" cy="60" r="50" stroke="var(--border-color2)" strokeWidth="10" fill="none" opacity="0.4" />
                <circle cx="60" cy="60" r="50" stroke="var(--gold)" strokeWidth="10" fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${(progress / 100) * 314} 314`}
                  transform="rotate(-90 60 60)"
                  style={{ transition: "stroke-dasharray .6s ease" }} />
              </svg>
              <div className="sap-donut-text">
                <strong>{progress}%</strong>
                <small>{localMasterySnapshot ? 'Dominio real' : 'Estimado'}</small>
              </div>
            </div>
          </div>

          <div className="sap-quote">
            <span className="sap-quote-mark">❝</span>
            <p>La consistencia convierte el estudio en dominio.</p>
          </div>
        </aside>

        <section className="sap-center">
          <svg className="sap-circle-svg" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
            <defs>
              {tools.map((t) => (
                <filter key={`glow-${t.id}`} id={`glow-${t.id}`} x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3.5" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              ))}
              <marker id="arrowActive" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill="#d6b26f" />
              </marker>
              <marker id="arrowMuted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill="#3a3a4a" />
              </marker>
            </defs>
            <circle cx={CIRCLE.cx} cy={CIRCLE.cy} r={CIRCLE.r} fill="none" stroke="#2a2a3a" strokeWidth="1" strokeDasharray="3 7" opacity="0.5" />
            {tools.map((tool) => {
              const startAngle = tool.angle - ARC_SPAN / 2;
              const endAngle = tool.angle + ARC_SPAN / 2;
              const isDone = completed[tool.id];
              const arcPath = describeArc(startAngle, endAngle, CIRCLE.r);
              return (
                <g key={`arc-${tool.id}`}>
                  <path d={arcPath} fill="none" stroke="#2f2f40" strokeWidth="3" strokeLinecap="round" opacity={isDone ? 0 : 0.85} />
                  {isDone && (
                    <path d={arcPath} fill="none" stroke={tool.colorHex} strokeWidth="4.5"
                      strokeLinecap="round" className="sap-arc-done" filter={`url(#glow-${tool.id})`} />
                  )}
                </g>
              );
            })}
            {tools.map((tool) => {
              if (!completed[tool.id]) return null;
              const point = polarToXY(tool.angle, CIRCLE.r);
              return (
                <line key={`spark-${tool.id}`} x1={CIRCLE.cx} y1={CIRCLE.cy} x2={point.x} y2={point.y}
                  stroke={tool.colorHex} strokeWidth="1.2" strokeDasharray="2 5" opacity="0.4" className="sap-spark-line" />
              );
            })}
            {arrows.map((arr) => {
              const midX = (arr.start.x + arr.end.x) / 2;
              const midY = (arr.start.y + arr.end.y) / 2;
              const dx = midX - CIRCLE.cx; const dy = midY - CIRCLE.cy;
              const len = Math.sqrt(dx * dx + dy * dy);
              const pushX = midX + (dx / len) * 28; const pushY = midY + (dy / len) * 28;
              const d = `M ${arr.start.x} ${arr.start.y} Q ${pushX} ${pushY} ${arr.end.x} ${arr.end.y}`;
              return (
                <path key={arr.id} d={d} fill="none"
                  stroke={arr.active ? arr.toColor : "#3a3a4a"}
                  strokeWidth={arr.active ? 2 : 1.5} strokeDasharray="5 5"
                  opacity={arr.active ? 0.85 : 0.5}
                  markerEnd={arr.active ? "url(#arrowActive)" : "url(#arrowMuted)"}
                  className={arr.active ? "sap-arrow-active" : ""} />
              );
            })}
          </svg>

          <div className="sap-paper-center">
            <div className="sap-paper-tape" />
            <div className="sap-paper-spiral">{Array.from({ length: 7 }).map((_, i) => <span key={i} />)}</div>
            <div className="sap-paper-icon">📖</div>
            <h2>Trust<br />the Process</h2>
            <div className="sap-paper-stats">
              <div><b>📚</b> {materiales.length} {materiales.length === 1 ? "material" : "materiales"}</div>
              <div><b>📄</b> {estimatedPages} páginas</div>
            </div>
            {completedCount === tools.length && <div className="sap-paper-done">✨ ¡Proceso completo!</div>}
          </div>

          {tools.map((tool) => {
            const noteRadius = CIRCLE.r + 78;
            const point = polarToXY(tool.angle, noteRadius);
            const leftPct = (point.x / VB_W) * 100;
            const topPct = (point.y / VB_H) * 100;
            return (
              <button key={tool.id}
                className={`sap-sticky ${completed[tool.id] ? "done" : ""}`}
                style={{ "--c": tool.color, "--tape": tool.tape, left: `${leftPct}%`, top: `${topPct}%` } as any}
                onClick={tool.action}>
                <div className="sap-sticky-tag">{tool.n}</div>
                <div className="sap-sticky-tape" />
                <div className="sap-sticky-head">
                  <span className="sap-sticky-emoji">{tool.emoji}</span>
                  <strong>{tool.title}</strong>
                </div>
                <p>{tool.desc}</p>
              </button>
            );
          })}
        </section>

        <aside className="sap-right">
          <div className="sap-card sap-card-progress">
            <h4>{localMasterySnapshot ? 'Dominio real' : 'Dominio estimado'}</h4>
            <strong className="sap-big-progress">{progress}%</strong>
          </div>

          <div className="sap-card">
            <h4>⭐ Recomendación</h4>
            <p className="sap-card-text">
              {localMasterySnapshot?.nextAction?.message || 'Usa las herramientas en cualquier orden según lo que necesites.'}
            </p>
          </div>

          {studyForecast.length > 0 && (
            <div className="sap-card">
              <h4>📈 Impacto estimado</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {studyForecast.map((f: any) => (
                  <div key={f.minutes} style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 800 }}>+{f.minutes} min</div>
                      <div style={{ fontSize: 11.5, color: 'var(--gold)', fontWeight: 900 }}>{progress}% → {f.expectedMastery}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="sap-tip">
            <span>💡</span>
            <p>Cada herramienta te acerca a tu mejor versión académica.<br /><b>~ ALAI</b></p>
          </div>
        </aside>
      </main>

      <div className="sap-coming-row">
        <small>Próximamente</small>
        <div className="sap-coming-grid">
          {[["Ejemplos","💡"],["Presentación","🎤"],["Audio Resumen","🎧"],["Mapa Mental","🧩"]].map(([label, icon]) => (
            <button key={label} onClick={() => onComingSoon(label)} className="sap-coming-pill">
              <span>{icon}</span><strong>{label}</strong><em>Próximamente</em>
            </button>
          ))}
        </div>
      </div>

      <style>{`
        .sap-screen { position:fixed;inset:0;overflow:auto;background:var(--bg-primary);color:var(--text-primary); }
        .sap-board-bg { position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 50% 40%,color-mix(in srgb,var(--gold) 5%,transparent),transparent 55%),radial-gradient(circle at 80% 80%,color-mix(in srgb,var(--blue) 4%,transparent),transparent 50%),radial-gradient(circle at 15% 75%,color-mix(in srgb,var(--red) 4%,transparent),transparent 50%); }
        .sap-board-grain { position:absolute;inset:0;pointer-events:none;opacity:.07;background-image:linear-gradient(to right,color-mix(in srgb,var(--text-primary) 18%,transparent) 1px,transparent 1px),linear-gradient(to bottom,color-mix(in srgb,var(--text-primary) 18%,transparent) 1px,transparent 1px);background-size:40px 40px; }
        .sap-topbar { position:sticky;top:0;z-index:30;display:flex;justify-content:space-between;align-items:center;padding:14px 24px;background:linear-gradient(to bottom,var(--bg-primary) 70%,transparent); }
        .sap-back,.sap-coach-btn { color:var(--blue);border:2px solid var(--blue);background:var(--bg-card);border-radius:14px;padding:9px 16px;font-size:13px;font-weight:800;cursor:pointer;box-shadow:3px 4px 0 var(--blue);transition:transform .2s ease,box-shadow .2s ease; }
        .sap-coach-btn:hover { transform:translate(-2px,-2px);box-shadow:5px 6px 0 var(--blue); }
        .sap-next-btn { color:var(--gold);border:2px solid var(--gold);background:var(--bg-card);border-radius:14px;padding:9px 16px;font-size:13px;font-weight:800;cursor:pointer;box-shadow:3px 4px 0 var(--gold);transition:transform .2s ease,box-shadow .2s ease; }
        .sap-back:hover,.sap-next-btn:hover { transform:translate(-2px,-2px);box-shadow:5px 6px 0 var(--gold); }
        .sap-canvas { position:relative;z-index:5;display:grid;grid-template-columns:210px 1fr 220px;gap:20px;padding:0 24px 18px;max-width:1500px;margin:0 auto;align-items:start;opacity:0;transform:translateY(8px);transition:opacity .5s ease,transform .5s ease; }
        .sap-canvas.ready { opacity:1;transform:none; }
        .sap-hero { margin-bottom:14px;padding:4px; }
        .sap-hero h1 { font-size:28px;line-height:1;font-weight:900;letter-spacing:-1px;margin:0; }
        .sap-hero h1 span { color:var(--red); }
        .sap-hero-underline { display:block;margin:4px 0 6px; }
        .sap-hero p { margin:0;color:var(--text-faint);font-size:12px;line-height:1.4; }
        .sap-card { background:var(--bg-card);border:1.5px solid var(--border-color2);border-radius:14px;padding:12px;margin-bottom:12px;box-shadow:0 8px 24px rgba(0,0,0,.25); }
        .sap-card h4 { margin:0 0 8px;font-size:12.5px;font-weight:800;color:var(--text-secondary); }
        .sap-card-meta { margin:6px 0 0;color:var(--text-faint);font-size:11.5px;font-weight:700; }
        .sap-card-text { margin:0;color:var(--text-muted);font-size:12px;line-height:1.45; }
        .sap-mat-icons { display:flex;gap:6px;flex-wrap:wrap; }
        .sap-mat-chip { width:34px;height:34px;display:grid;place-items:center;background:var(--bg-secondary);border:1.5px solid var(--border-color);border-radius:8px;font-size:16px; }
        .sap-mat-more { font-size:11px;font-weight:800;color:var(--gold); }
        .sap-donut-wrap { position:relative;width:96px;height:96px;margin:2px auto 4px; }
        .sap-donut { width:100%;height:100%; }
        .sap-donut-text { position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center; }
        .sap-donut-text strong { font-size:20px;font-weight:900;color:var(--gold);line-height:1; }
        .sap-donut-text small { font-size:9px;color:var(--text-faint);margin-top:2px; }
        .sap-quote { background:transparent;padding:6px 4px;color:var(--text-faint);font-size:12px;line-height:1.45;font-style:italic; }
        .sap-quote-mark { font-size:20px;color:var(--gold);margin-right:4px;vertical-align:-4px; }
        .sap-center { position:relative;width:100%;aspect-ratio:${VB_W}/${VB_H};max-width:820px;margin:0 auto; }
        .sap-circle-svg { position:absolute;inset:0;width:100%;height:100%;pointer-events:none; }
        .sap-arc-done { stroke-dasharray:250;stroke-dashoffset:250;animation:sapDrawArc 1s cubic-bezier(.4,0,.2,1) forwards; }
        @keyframes sapDrawArc { to { stroke-dashoffset:0; } }
        .sap-spark-line { stroke-dasharray:120;stroke-dashoffset:120;animation:sapDrawSpark .8s ease forwards; }
        @keyframes sapDrawSpark { to { stroke-dashoffset:0; } }
        .sap-arrow-active { animation:sapArrowPulse 2s ease infinite; }
        @keyframes sapArrowPulse { 0%,100%{opacity:.85}50%{opacity:1} }
        .sap-paper-center { position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-1deg);width:180px;min-height:215px;background:repeating-linear-gradient(to bottom,#f5ecd6 0 26px,#ead9b3 26px 27px);color:#1a1a1a;border:2px solid rgba(0,0,0,.3);border-radius:6px;padding:22px 14px 14px 28px;text-align:center;box-shadow:7px 10px 0 rgba(0,0,0,.45),0 22px 60px rgba(0,0,0,.5);z-index:7; }
        .sap-paper-tape { position:absolute;top:-12px;left:50%;width:80px;height:22px;transform:translateX(-50%) rotate(-2deg);background:color-mix(in srgb,var(--gold) 70%,#c8a05a);opacity:.88;box-shadow:0 3px 8px rgba(0,0,0,.25); }
        .sap-paper-spiral { position:absolute;left:9px;top:12px;bottom:12px;width:10px;display:flex;flex-direction:column;justify-content:space-around; }
        .sap-paper-spiral span { width:9px;height:9px;border-radius:50%;background:rgba(0,0,0,.55);box-shadow:inset 0 -1px 0 rgba(255,255,255,.4); }
        .sap-paper-icon { font-size:24px;margin-bottom:2px; }
        .sap-paper-center h2 { margin:4px 0 10px;font-size:22px;line-height:1;font-weight:900;color:#1a1a1a;letter-spacing:-0.5px; }
        .sap-paper-stats { font-size:11px;font-weight:800;color:#2a2a2a;display:flex;flex-direction:column;gap:3px;align-items:center; }
        .sap-paper-done { margin-top:8px;padding:5px 7px;background:color-mix(in srgb,var(--gold) 30%,transparent);border:1.5px solid var(--gold);border-radius:8px;font-size:10px;font-weight:900;color:#1a1a1a;animation:sapPulse 1.5s ease infinite; }
        @keyframes sapPulse { 0%,100%{transform:scale(1)}50%{transform:scale(1.05)} }
        .sap-sticky { position:absolute;width:148px;padding:10px 9px 9px;background:var(--bg-card);border:2px solid var(--c);border-radius:4px;color:var(--text-primary);cursor:pointer;text-align:left;box-shadow:0 6px 18px rgba(0,0,0,.4),0 0 0 1px color-mix(in srgb,var(--c) 25%,transparent);transition:transform .25s ease,box-shadow .25s ease;z-index:8;transform:translate(-50%,-50%); }
        .sap-sticky:hover { transform:translate(-50%,-50%) scale(1.06);box-shadow:0 14px 30px rgba(0,0,0,.5),0 0 22px color-mix(in srgb,var(--c) 45%,transparent);z-index:9; }
        .sap-sticky.done { background:color-mix(in srgb,var(--c) 16%,var(--bg-card)); }
        .sap-sticky-tape { position:absolute;top:-9px;left:50%;width:50px;height:13px;transform:translateX(-50%) rotate(-3deg);background:var(--tape);opacity:.85;box-shadow:0 2px 6px rgba(0,0,0,.3); }
        .sap-sticky-tag { position:absolute;top:-9px;right:8px;background:var(--c);color:#0a0a0a;font-size:9.5px;font-weight:950;padding:2px 6px;border-radius:4px;box-shadow:0 3px 6px rgba(0,0,0,.3); }
        .sap-sticky-head { display:flex;align-items:center;gap:6px;margin-bottom:4px; }
        .sap-sticky-emoji { font-size:15px; }
        .sap-sticky-head strong { font-size:12.5px;font-weight:900;color:var(--c); }
        .sap-sticky p { margin:0;font-size:10px;line-height:1.32;color:var(--text-muted); }
        .sap-card-progress strong.sap-big-progress { display:block;font-size:32px;font-weight:900;color:var(--gold);line-height:1;margin-top:4px; }
        .sap-legend { list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px; }
        .sap-legend li { display:grid;grid-template-columns:10px 1fr auto;align-items:center;gap:8px;font-size:11px; }
        .sap-legend i { width:9px;height:9px;border-radius:50%;display:block; }
        .sap-legend span { color:var(--text-secondary);font-weight:700; }
        .sap-legend em { color:var(--text-faint);font-style:normal;font-size:10px; }
        .sap-tip { background:color-mix(in srgb,var(--gold) 8%,transparent);border:1.5px dashed var(--gold-border);border-radius:12px;padding:10px;display:flex;gap:8px;align-items:flex-start; }
        .sap-tip span { font-size:16px; }
        .sap-tip p { margin:0;font-size:11.5px;line-height:1.45;color:var(--text-muted); }
        .sap-tip b { color:var(--gold);font-weight:900; }
        .sap-coming-row { position:relative;z-index:5;max-width:1500px;margin:0 auto 20px;padding:0 24px;text-align:center; }
        .sap-coming-row small { display:inline-block;margin-bottom:10px;font-size:13px;font-weight:800;color:var(--gold); }
        .sap-coming-grid { display:grid;grid-template-columns:repeat(4,minmax(0,150px));gap:12px;justify-content:center; }
        .sap-coming-pill { background:var(--bg-card);border:1.5px dashed var(--border-color2);border-radius:12px;padding:12px 8px;color:var(--text-secondary);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;transition:all .2s ease; }
        .sap-coming-pill:hover { border-color:var(--gold);color:var(--gold);transform:translateY(-3px);box-shadow:0 10px 24px rgba(0,0,0,.3); }
        .sap-coming-pill span { font-size:20px; }
        .sap-coming-pill strong { font-size:12.5px;font-weight:800; }
        .sap-coming-pill em { font-size:9.5px;font-style:normal;color:var(--text-faint); }
        @media (max-width:1180px) { .sap-canvas { grid-template-columns:190px 1fr 200px;gap:14px; } .sap-sticky { width:135px; } }
        @media (max-width:960px) { .sap-canvas { grid-template-columns:1fr; } .sap-left,.sap-right { display:grid;grid-template-columns:1fr 1fr;gap:12px; } .sap-hero { grid-column:1/-1; } }
        @media (max-width:640px) { .sap-left,.sap-right { grid-template-columns:1fr; } .sap-coming-grid { grid-template-columns:repeat(2,1fr); } .sap-sticky { width:122px;padding:8px 7px 7px; } }
      `}</style>
    </div>
  );
}
