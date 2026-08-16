'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef, useMemo, useCallback} from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import dynamicImport from 'next/dynamic';
import { getMaterias, saveMaterias, lookupMateriasDesdeDB, generateId, Materia, Tema, Apunte, Documento } from '../../lib/storage';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';
import NavbarMobile from '../../components/NavbarMobile';
import StudyLoader from '../../components/StudyLoader';
const MateriasList = dynamicImport(() => import('../../components/materias/MateriasList'));
const MateriaView = dynamicImport(() => import('../../components/materias/MateriaView'));
const TemaView = dynamicImport(() => import('../../components/materias/TemaView'));
const ApunteEditor = dynamicImport(() => import('../../components/materias/ApunteEditor'));
const DocumentoView = dynamicImport(() => import('../../components/materias/DocumentoView'));
const ALAIStudyALCards = dynamicImport(() => import('../../components/materias/ALAIStudyALCards'), { ssr: false });
const ALAIStudyALQuizzes = dynamicImport(() => import('../../components/materias/ALAIStudyALQuizzes'), { ssr: false });
const ALAIStudyALRepasar = dynamicImport(() => import('../../components/materias/ALAIStudyALRepasar'), { ssr: false });
const ALAIStudyALChat = dynamicImport(() => import('../../components/materias/ALAIStudyALChat'), { ssr: false });
const ALAIStudyALExams = dynamicImport(() => import('../../components/materias/ALAIStudyALExams'), { ssr: false });
const AnalisisTeorico = dynamicImport(() => import('../../components/materias/AnalisisTeorico'), { ssr: false });
const ModalMateria = dynamicImport(() => import('../../components/materias/Modales').then(mod => mod.ModalMateria));
const ModalTema = dynamicImport(() => import('../../components/materias/Modales').then(mod => mod.ModalTema));
const ModalApunte = dynamicImport(() => import('../../components/materias/Modales').then(mod => mod.ModalApunte));
import Buscador from '../../components/Buscador';
import MaterialUploader from '../../components/materials/MaterialUploader';
import type { MaterialUI } from '../../lib/materials/types';
import {
  getMasteryStorageKey,
  loadMaterialMastery,
  saveMaterialMastery,
  createEmptyMastery,
  processEvent,
  calculateMasterySnapshot,
  buildMasteryContext,
  applyForgettingCurve,
  buildSessionSummary,
  type MaterialMastery,
  type MasteryEvent,
  type MasterySnapshot,
  type MasteryContext,
  type SessionSummary,
} from '../../lib/masteryEngine';
import { getSessionById, getSessionsByTema, lookupSessionByIdFromServer, syncSessionsFromServer } from '../../lib/studySessions';
import { hasPersistedAdaptiveArtifacts } from '../../lib/adaptive/resume';
import { buildSourceSelectionFromMaterials } from '../../lib/adaptive/sourceSelection';
import { freeNavDebug, freeNavCallsite, nextFreeNavRenderId } from '../../lib/debug/freeNavDebug';

type Vista = 'materias' | 'materia' | 'tema' | 'apunte' | 'documento' | 'flashcards' | 'quiz' | 'repasar' | 'analisis' | 'alai' | 'exam';

export default function MateriasPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [materiasRestoreStatus, setMateriasRestoreStatus] = useState<'RESTORING' | 'READY' | 'ERROR'>('RESTORING');
  const [vista, setVista] = useState<'lista' | 'materia' | 'materias' | 'apunte' | 'tema' | 'documento' | 'flashcards' | 'quiz' | 'repasar' | 'analisis' | 'alai' | 'exam'>(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('open')) return 'materia';
    }
    return 'lista';
  });
  const [materiaActual, setMateriaActual] = useState<Materia | null>(null);
  const [temaActual, setTemaActual] = useState<Tema | null>(null);
  const [flashcardsMateriales, setFlashcardsMateriales] = useState<any[]>([]);
  const [flashcardsSeleccion, setFlashcardsSeleccion] = useState<any[] | null>(null);
  const [flashcardsSessionId, setFlashcardsSessionId] = useState<string | null>(null);
  const [freeToolSessionId, setFreeToolSessionId] = useState<string | null>(null);
  const [quizMateriales, setQuizMateriales]   = useState<any[]>([]);
  const [quizSeleccion,  setQuizSeleccion]    = useState<any[] | undefined>(undefined);
  const [repasarMateriales, setRepasarMateriales] = useState<any[]>([]);
  const [repasarSeleccion, setRepasarSeleccion] = useState<any[] | null>(null);
  const [analisisMateriales, setAnalisisMateriales] = useState<any[]>([]);
  const [analisisSeleccion, setAnalisisSeleccion] = useState<any[] | null>(null);
  const [alaiMateriales, setAlaiMateriales] = useState<any[]>([]);
  const [alaiSeleccion, setAlaiSeleccion] = useState<any[] | null>(null);
  const [examMateriales, setExamMateriales] = useState<any[]>([]);
  const [examSeleccion, setExamSeleccion] = useState<any[] | null>(null);
  const [returnToEnfoque, setReturnToEnfoque] = useState(false);
  const [returnSessionId, setReturnSessionId] = useState<string | null>(null);
  // Canonical Tool → StudyAL Process return seed: set synchronously in the
  // same tick as returnToEnfoque/returnSessionId, so TemaView's very FIRST
  // render (lazy useState initializers) can already show StudyAL Process —
  // no intermediate frame of TemaView's own view is ever painted.
  const [freeReturnSeed, setFreeReturnSeed] = useState<{
    sessionId: string | null;
    materiales: any[];
    seleccion: any;
    studyMode: 'free';
  } | null>(null);

  const [autoOpenAdaptive, setAutoOpenAdaptive] = useState(false);
  const [autoOpenAdaptiveSessionId, setAutoOpenAdaptiveSessionId] = useState<string | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const adaptiveResumeExtractionGuardRef = useRef(
    typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).has('adaptiveSessionId'),
  );
  const createLocksRef = useRef(new Set<string>());
  const cargarRunCountRef = useRef(0);
  const prevSessionRefForDebug = useRef<typeof session>(undefined);
  const urlRestoreConsumedRef = useRef(false);
  const hasBootstrappedRef = useRef(false);

  // ─── [free-nav-debug] instrumentation (BUG REAL #2, dev-only) ───
  const freeNavRenderId = nextFreeNavRenderId();
  if (process.env.NODE_ENV !== 'production') {
    freeNavDebug('RENDER', {
      renderId: freeNavRenderId,
      vista,
      freeToolSessionId,
      returnSessionId,
      resumeSessionId: null,
      temaId: temaActual?.id || null,
      materiaId: materiaActual?.id || null,
      selectedMaterialIds: (temaActual?.documentos || []).map((d: any) => d?.materialId || d?.id).filter(Boolean),
      flashcardsFingerprint: (flashcardsSeleccion && flashcardsMateriales?.length)
        ? buildSourceSelectionFromMaterials(flashcardsMateriales, flashcardsSeleccion).fingerprint
        : null,
    });
  }

  function setVistaDebug(
    next: 'lista' | Vista | ((prev: string) => string),
    reason?: string,
  ) {
    if (process.env.NODE_ENV === 'production') {
      setVista(next as any);
      return;
    }
    const callsite = freeNavCallsite(3);
    setVista(prev => {
      const resolved = typeof next === 'function' ? (next as any)(prev) : next;
      if (resolved !== prev) {
        freeNavDebug('VIEW_TRANSITION', {
          old: prev,
          new: resolved,
          reason: reason || 'unspecified',
          callsite,
          renderId: freeNavRenderId,
          freeToolSessionId,
          returnSessionId,
          temaId: temaActual?.id || null,
        });
      }
      return resolved;
    });
  }

  // ─── Canonical Tool → StudyAL Process return (all 8 Free tools) ───
  // "← Volver al proceso" must be an atomic transition: TemaView must never
  // visibly render between the Tool and StudyAL Process. Setting
  // freeReturnSeed synchronously (same tick as returnToEnfoque/
  // returnSessionId, before vista flips) lets TemaView seed openFree=true
  // (and the materials/selection StudyAL Process needs) on its very FIRST
  // render via lazy useState initializers — so it never paints its own
  // default view first.
  function returnToFreeProcess(
    toolId: string,
    materiales: any[],
    seleccion: any,
    toolSessionId: string | null,
    reason?: string,
  ) {
    const sid = toolSessionId || freeToolSessionId;
    setFreeReturnSeed({ sessionId: sid, materiales, seleccion, studyMode: 'free' });
    setReturnSessionId(sid);
    setReturnToEnfoque(true);
    requestAnimationFrame(() => {
      setVistaDebug('tema', reason || `${toolId}:onBack:volver-al-proceso`);
    });
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const routeParams = new URLSearchParams(window.location.search);
    const adaptiveSessionId = routeParams.get('adaptiveSessionId');
    const temaId = routeParams.get('temaId');
    if (!adaptiveSessionId) {
      adaptiveResumeExtractionGuardRef.current = false;
      return;
    }

    // Un ID adaptativo explícito se resuelve antes de permitir inicializaciones
    // de background. La studySession del servidor, no el estado React, decide.
    adaptiveResumeExtractionGuardRef.current = true;
    syncSessionsFromServer(temaId || undefined)
      .then(() => {
        const persisted = getSessionById(adaptiveSessionId);
        adaptiveResumeExtractionGuardRef.current = hasPersistedAdaptiveArtifacts(persisted);
      })
      .catch(() => {
        // Un fallo de carga no autoriza generación: conservar el guard evita
        // confundir "todavía no cargó" con "no existe".
        adaptiveResumeExtractionGuardRef.current = true;
      });
  }, []);

  // ── Auto-inicializar mastery cuando hay tema activo ──
  // Se ejecuta cuando el usuario entra a un tema que tiene documentos
  // No espera a que abra ninguna herramienta
  // Auto-abrir tema + adaptativo si viene desde /materias/[tema]/sesion/[N]
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (materiasRestoreStatus !== 'READY') return;

    // Esto es una restauración ÚNICA desde la URL/localStorage al cargar,
    // no un sync continuo. `materias` está en las deps solo porque el primer
    // ciclo de carga puede tardar en poblarla — pero un refetch de sesión
    // (NextAuth refresca en cada visibilitychange/focus) también produce una
    // referencia nueva de `materias` y volvía a disparar este efecto DENTRO
    // de una herramienta ya abierta, forzando `setVista('tema')` y tumbando
    // (unmount) la herramienta activa a mitad de una generación en curso.
    // Consumir la restauración una sola vez separa "los datos se
    // refrescaron" de "hay que renavegar" — la navegación explícita del
    // usuario (o la restauración ya aplicada) tiene precedencia.
    if (urlRestoreConsumedRef.current) return;

    // BUG REAL #2: consumir el guard AQUÍ — ANTES de leer targetTemaId, no
    // solo cuando hay match. Otro efecto (URL-sync, más abajo en este
    // archivo) escribe `?temaId=&freeSessionId=&freeTool=` en la URL en
    // cuanto el usuario entra a una herramienta Free — vía NAVEGACIÓN
    // NORMAL, sin pasar nunca por este restore. Si el guard solo se
    // consumiera al encontrar `targetTemaId`, la primera pasada (URL vacía,
    // navegación interactiva normal) hacía `return` en el chequeo de abajo
    // SIN marcar el guard, dejándolo "armado" indefinidamente. Un refetch de
    // sesión posterior (NextAuth refresca en cada visibilitychange/focus)
    // volvía a disparar este efecto, ahora sí encontraba `targetTemaId` en
    // la URL (recién escrita por el otro efecto) y trataba la navegación
    // interactiva en curso como si fuera un deep-link fresco: rebobinaba a
    // 'tema' y reabría la herramienta Free como instancia nueva, abortando
    // cualquier generación en curso. Este efecto solo tiene UNA oportunidad
    // legítima de restaurar (al primer instante en que `materias` está
    // READY); si no hay match en ese intento, no existe una restauración
    // pendiente real.
    urlRestoreConsumedRef.current = true;

    const routeParams = new URLSearchParams(window.location.search);
    const targetTemaId = routeParams.get('temaId') || localStorage.getItem('studyal_open_tema');
    if (!targetTemaId) return;

    if (process.env.NODE_ENV !== 'production') {
      freeNavDebug('EFFECT_RUN', {
        effect: 'findAndOpen(temaId-url-restore)',
        deps: 'materias,materiasRestoreStatus',
        materiasRefChanged: true,
        currentVista: vista,
      });
    }
    const findAndOpen = () => {
      try {
        for (const materia of materias) {
          const tema = (materia.temas || []).find((t: any) => t.id === targetTemaId);
          if (tema) {
            setMateriaActual(materia);
            setTemaActual(tema);
            setVistaDebug('tema', 'findAndOpen-effect:sync-open-tema(one-shot)');
            const routeSessionId = routeParams.get('adaptiveSessionId');
            const openAdaptive = routeParams.get('adaptiveView') === 'plan'
              || localStorage.getItem('studyal_open_tema_adaptive') === 'true';
            setAutoOpenAdaptive(openAdaptive);
            setAutoOpenAdaptiveSessionId(routeSessionId || localStorage.getItem('studyal_open_adaptive_session_id'));
            const freeSessionId = routeParams.get('freeSessionId');
            const freeTool = routeParams.get('freeTool') as Vista | null;
            if (freeSessionId && freeTool && ['flashcards', 'quiz', 'repasar', 'analisis', 'alai', 'exam'].includes(freeTool)) {
              lookupSessionByIdFromServer(freeSessionId, targetTemaId).then((lookup) => {
                if (lookup.status !== 'FOUND') return;
                const freeSession = lookup.sessions.find(session => session.id === freeSessionId) || null;
                if (!freeSession || freeSession.processMode !== 'free' || freeSession.temaId !== targetTemaId) return;
                const restoredSource = buildSourceSelectionFromMaterials(
                  freeSession.materialIds.map(materialId => ({ materialId })),
                  freeSession.materialIds.map((materialId, materialIndex) => ({ materialId, materialIndex, pages: freeSession.selectedPages?.[materialId] || [] })),
                );
                if (restoredSource.fingerprint !== freeSession.sourceSelectionFingerprint) return;
                const idSet = new Set(freeSession.materialIds.map(String));
                const selectedMaterials = (tema.documentos || []).filter((document: any) =>
                  idSet.has(String(document?.materialId || document?.id || '')),
                );
                if (selectedMaterials.length !== freeSession.materialIds.length) return;
                const restoredSelection = freeSession.materialIds.map((materialId, materialIndex) => ({
                  materialId,
                  materialIndex,
                  pages: freeSession.selectedPages?.[materialId] || [],
                }));
                setFreeToolSessionId(freeSession.id);
                if (freeTool === 'flashcards') { setFlashcardsMateriales(selectedMaterials); setFlashcardsSeleccion(restoredSelection); setFlashcardsSessionId(freeSession.id); }
                if (freeTool === 'quiz') { setQuizMateriales(selectedMaterials); setQuizSeleccion(restoredSelection); }
                if (freeTool === 'repasar') { setRepasarMateriales(selectedMaterials); setRepasarSeleccion(restoredSelection); }
                if (freeTool === 'analisis') { setAnalisisMateriales(selectedMaterials); setAnalisisSeleccion(restoredSelection); }
                if (freeTool === 'alai') { setAlaiMateriales(selectedMaterials); setAlaiSeleccion(restoredSelection); }
                if (freeTool === 'exam') { setExamMateriales(selectedMaterials); setExamSeleccion(restoredSelection); }
                // Solo aplicar la navegación restaurada si el usuario sigue donde
                // esta restauración lo dejó (vista==='tema'). Si ya navegó
                // explícitamente a otra parte mientras el lookup estaba en
                // vuelo, esa navegación explícita gana — no la pisamos.
                setVistaDebug(
                  prev => (prev === 'tema' ? freeTool : prev),
                  'findAndOpen-effect:async-lookupSessionByIdFromServer-resolved:restore-free-tool(one-shot)',
                );
              }).catch(() => {
                // Un fallo durable no autoriza usar todos los materiales como fallback.
              });
            }
            localStorage.removeItem('studyal_open_tema');
            localStorage.removeItem('studyal_open_tema_adaptive');
            return true;
          }
        }
      } catch (e) {
        console.warn('Error buscando tema:', e);
      }
      return false;
    };

    findAndOpen();
  }, [materias, materiasRestoreStatus]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const freeTools = new Set(['flashcards', 'quiz', 'repasar', 'analisis', 'alai', 'exam']);
    const url = new URL(window.location.href);
    if (freeTools.has(vista) && freeToolSessionId && temaActual?.id) {
      url.searchParams.set('temaId', temaActual.id);
      url.searchParams.set('freeSessionId', freeToolSessionId);
      url.searchParams.set('freeTool', vista);
    } else if (vista === 'tema') {
      const internalTool = url.searchParams.get('freeTool');
      if (internalTool === 'studymap' || internalTool === 'truquitos' || internalTool === 'hub') return;
      url.searchParams.delete('freeSessionId');
      url.searchParams.delete('freeTool');
    } else {
      return;
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  }, [vista, freeToolSessionId, temaActual?.id]);

  useEffect(() => {
    if (!temaActual?.documentos?.length) return;
    if (vista !== 'tema') return;

    const docs = temaActual.documentos;
    const ids = docs
      .map((d: any) => String(d?.materialId || d?.id || ''))
      .filter(Boolean);

    if (!ids.length) return;

    // Solo inicializar si no hay mastery activo o es de otro tema
    const currentKey = getMasteryStorageKey(ids);
    if (masteryState?.sessionKey === currentKey) return;

    const names = docs.map((d: any) => d?.nombre || d?.name || 'Material');
    initMastery(ids, names);
  }, [temaActual?.id, vista]);

  // ── Mastery Engine — vive aquí, persiste entre vistas ──
  const [masteryState, setMasteryState] = useState<MaterialMastery | null>(null);
  const [masterySnapshot, setMasterySnapshot] = useState<MasterySnapshot | null>(null);

  // FIX P0: memoizar sourceSelection y masteryContext para evitar bounce.
  // Antes se construian inline en JSX (nueva identidad cada render) → useAuthorizedSource
  // veia snapshot nuevo → refetch → setResult(null) → UI de la herramienta desaparecia.
  const flashcardsSource = useMemo(
    () => buildSourceSelectionFromMaterials(flashcardsMateriales, flashcardsSeleccion),
    [flashcardsMateriales, flashcardsSeleccion],
  );
  const quizSource = useMemo(
    () => buildSourceSelectionFromMaterials(quizMateriales, quizSeleccion),
    [quizMateriales, quizSeleccion],
  );
  const repasarSource = useMemo(
    () => buildSourceSelectionFromMaterials(repasarMateriales, repasarSeleccion),
    [repasarMateriales, repasarSeleccion],
  );
  const analisisSource = useMemo(
    () => buildSourceSelectionFromMaterials(analisisMateriales, analisisSeleccion),
    [analisisMateriales, analisisSeleccion],
  );
  const alaiSource = useMemo(
    () => buildSourceSelectionFromMaterials(alaiMateriales, alaiSeleccion),
    [alaiMateriales, alaiSeleccion],
  );
  const examSource = useMemo(
    () => buildSourceSelectionFromMaterials(examMateriales, examSeleccion),
    [examMateriales, examSeleccion],
  );
  const memoizedMasteryContext = useMemo(
    () => buildMasteryContext(masteryState),
    [masteryState],
  );


  // Auto-extraer conceptos en background cuando el mastery existe pero no tiene conceptos
  const autoExtractConcepts = async (mastery: MaterialMastery) => {
    if (adaptiveResumeExtractionGuardRef.current) return;
    if (!mastery || mastery.conceptsExtracted || mastery.concepts.length > 0) return;
    if (!mastery.materialId && !mastery.sessionKey) return;

    try {
      const materialIds = mastery.sessionKey
        .replace('studyal_mastery_v2_', '')
        .split('-')
        .filter(Boolean);

      if (!materialIds.length) return;

      console.log('%c🧠 Mastery: extrayendo conceptos en background...', 'background:#a78bfa;color:#000;padding:2px 6px;border-radius:4px;font-weight:900');

      // 1. Cargar texto
      const res = await fetch('/api/enfoques/teorico/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ materialIds }),
      });
      const data = await res.json();
      if (!data.materials) return;

      const fullText = Object.entries(data.materials)
        .map(([id, m]: [string, any]) => (m.text || '').trim())
        .filter(Boolean)
        .join('\n\n---\n\n');

      if (!fullText.trim()) return;

      // 2. Extraer conceptos
      const extractRes = await fetch('/api/mastery/extract-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialText: fullText.slice(0, 25000),
          materialId: materialIds[0],
          tema: temaActual?.nombre || '',
          materia: materiaActual?.nombre || '',
        }),
      });

      const extractData = await extractRes.json();
      if (!extractData.success || !extractData.concepts?.length) return;

      const extractedConcepts = extractData.concepts;
      console.log(
        '%c✅ Mastery: conceptos extraídos automáticamente',
        'background:#4ade80;color:#000;padding:2px 6px;border-radius:4px;font-weight:900',
        extractedConcepts
      );

      const newConcepts = extractedConcepts.map((name: string) => ({
        id: name.toLowerCase().replace(/\s+/g, '_').slice(0, 50),
        name,
        materialId: materialIds[0],
        understanding: 0, memory: 0, application: 0,
        explanation: 0, exam: 0, confidence: 0,
        speed: 0, stability: 0, attempts: 0, mistakes: 0,
        lastReviewed: null, previousScores: [],
        forgettingRisk: 'very_high' as const,
        recommendedAction: 'Empieza con Repasar.',
        recommendedTool: 'repasar' as const,
      }));

      setMasteryState(prev => {
        if (!prev) return prev;
        const updated = {
          ...prev,
          concepts: newConcepts,
          conceptsExtracted: true,
          lastUpdated: Date.now(),
        };
        saveMaterialMastery(updated);
        setMasterySnapshot(calculateMasterySnapshot(updated));
        return updated;
      });

      // Extraer Knowledge Graph en background (no bloquea)
      setTimeout(async () => {
        try {
          const graphRes = await fetch('/api/mastery/extract-graph', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              materialText: fullText.slice(0, 12000),
              concepts: extractedConcepts,
              materialId: materialIds[0],
              tema: temaActual?.nombre || '',
              materia: materiaActual?.nombre || '',
            }),
          });
          const graphData = await graphRes.json();
          if (graphData.success && graphData.relations?.length) {
            console.log(
              '%c🕸️ Knowledge Graph extraído',
              'background:#a78bfa;color:#000;padding:2px 6px;border-radius:4px;font-weight:900',
              graphData.relations.length, 'relaciones'
            );
            setMasteryState(prev => {
              if (!prev) return prev;
              const withGraph = {
                ...prev,
                knowledgeGraph: {
                  concepts: extractedConcepts,
                  relations: graphData.relations,
                },
                lastUpdated: Date.now(),
              };
              saveMaterialMastery(withGraph);
              return withGraph;
            });
          }
        } catch (e) {
          console.warn('Knowledge Graph extraction failed:', e);
        }
      }, 2000);

    } catch (err) {
      console.warn('Mastery auto-extract error:', err);
    }
  };

  // Inicializar/actualizar mastery cuando cambian los materiales seleccionados
  const initMastery = (materialIds: string[], materialNames: string[]) => {
    if (!materialIds.length) return;
    const sessionKey = getMasteryStorageKey(materialIds);
    const loaded = loadMaterialMastery(sessionKey);

    // Aplicar curva de olvido al cargar (actualiza valores según tiempo transcurrido)
    const mastery = loaded
      ? applyForgettingCurve(loaded)
      : createEmptyMastery({ materialIds, materialNames, sessionKey });

    setMasteryState(mastery);
    setMasterySnapshot(calculateMasterySnapshot(mastery));

    // Guardar el estado con el olvido aplicado
    if (loaded) saveMaterialMastery(mastery);

    // Auto-extraer conceptos si no los tiene
    if (!adaptiveResumeExtractionGuardRef.current
      && !mastery.conceptsExtracted
      && !mastery.concepts.length) {
      setTimeout(() => autoExtractConcepts(mastery), 500);
    }
  };

  // Construir contexto de mastery para pasarlo a las herramientas
  const getMasteryContext = (): MasteryContext | null => {
    return buildMasteryContext(masteryState);
  };

  // Extraer conceptos débiles del estado actual para pasarlos a las herramientas
  const getWeakConcepts = (): string[] => {
    if (!masteryState?.concepts?.length) return [];
    return masteryState.concepts
      .filter((c: any) => {
        const score = (c.understanding * 0.25 + c.memory * 0.20 +
          c.application * 0.20 + c.explanation * 0.15 + c.exam * 0.20);
        const name = c.name || '';
        // Solo conceptos reales (no preguntas)
        if (name.includes('?') || name.length > 60) return false;
        return score < 50;
      })
      .sort((a: any, b: any) => {
        const scoreA = a.understanding * 0.25 + a.memory * 0.20 + a.application * 0.20;
        const scoreB = b.understanding * 0.25 + b.memory * 0.20 + b.application * 0.20;
        return scoreA - scoreB;
      })
      .map((c: any) => c.name)
      .slice(0, 8);
  };

  // Función que reciben todas las herramientas para reportar eventos.
  // FIX P0: useCallback con deps vacías + short-circuit si processEvent
  // devuelve la misma identidad de mastery (idempotencia). Antes, cada
  // render de MateriasPage recreaba esta función → cambio de identidad de
  // prop `onMasteryEvent` en las 8 herramientas → useEffect de cada tool
  // detectaba cambio de dep y re-disparaba → tormenta de writes.
  const reportMasteryEvent = useCallback((event: Omit<MasteryEvent, 'sessionKey'>) => {
    setMasteryState(prev => {
      if (!prev) return prev;
      const fullEvent: MasteryEvent = {
        ...event,
        sessionKey: prev.sessionKey,
        timestamp: Date.now(),
      };
      const updated = processEvent(prev, fullEvent);
      // Si processEvent devuelve el mismo objeto (nada cambio), no persistimos
      // ni recalculamos snapshot ni disparamos re-render.
      if (updated === prev) return prev;
      saveMaterialMastery(updated);
      setMasterySnapshot(calculateMasterySnapshot(updated));
      return updated;
    });
  }, []);

  const normalizePages = (value: any): number[] => {
    if (Array.isArray(value)) {
      return Array.from(new Set(
        value.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
      )).sort((a: number, b: number) => a - b);
    }

    if (value && typeof value === 'object') {
      const start = Number(value.start || value.from || value.startPage);
      const end = Number(value.end || value.to || value.endPage);
      if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
        return Array.from({ length: end - start + 1 }, (_, i) => start + i);
      }
    }

    return [];
  };

  const normalizeSeleccionForFlashcards = (rawSel: any[] | null | undefined, mats: any[]) => {
    if (!Array.isArray(rawSel) || rawSel.length === 0) return null;

    const getIds = (item: any): string[] => {
      const nested =
        item?.material ||
        item?.documento ||
        item?.doc ||
        item?.source ||
        item?.file ||
        null;

      return [
        item?.materialId,
        item?.material_id,
        item?.documentId,
        item?.document_id,
        item?.docId,
        item?.doc_id,
        item?.id,
        nested?.materialId,
        nested?.material_id,
        nested?.id,
      ]
        .filter(Boolean)
        .map((v: any) => String(v));
    };

    const normalized = (mats || [])
      .map((mat: any, index: number) => {
        const matMaterialId = String(mat?.materialId || mat?.material_id || mat?.id || '');
        const matDocumentId = String(mat?.id || '');

        const byMaterialIndex =
          rawSel.find((item: any) => Number(item?.materialIndex) === index) || null;

        const byId =
          rawSel.find((item: any) => {
            const ids = getIds(item);
            return ids.includes(matMaterialId) || ids.includes(matDocumentId);
          }) || null;

        const item: any = byMaterialIndex ?? byId ?? rawSel[index] ?? null;
        if (!item) return null;

        const pages = [
          item?.pages,
          item?.selectedPages,
          item?.paginasSeleccionadas,
          item?.paginas,
          item?.pageNumbers,
          item?.range,
          item?.selection,
        ]
          .map(normalizePages)
          .find((arr: any) => Array.isArray(arr) && arr.length > 0) || [];

        const text =
          item?.text ||
          item?.texto ||
          item?.selectedText ||
          item?.content ||
          item?.contenido ||
          item?.extractedText ||
          item?.rawText ||
          item?.extract ||
          item?.selected?.text ||
          undefined;

        if (!pages.length && !text) return null;

        return {
          materialId: matMaterialId,
          documentId: matDocumentId,
          materialIndex: index,
          pages,
          text,
        };
      })
      .filter(Boolean);

    console.log('🧩 Flashcards selección RAW:', rawSel);
    console.log('✅ Flashcards selección NORMALIZADA:', normalized);

    return normalized.length ? normalized : null;
  };
  const [apunteActual, setApunteActual] = useState<Apunte | null>(null);
  const [documentoActual, setDocumentoActual] = useState<Documento | null>(null);
  const [modalMateria, setModalMateria] = useState(false);
  const [modalTema, setModalTema] = useState(false);
  const [modalApunte, setModalApunte] = useState(false);
  const [subiendoDoc, setSubiendoDoc] = useState(false);
  const [showUploader, setShowUploader] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [showBuscador, setShowBuscador] = useState(false);
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const openParam = searchParams?.get('open') || '';
  const { tr, idioma } = useIdioma();

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      cargarRunCountRef.current += 1;
      const sessionChanged = prevSessionRefForDebug.current !== session;
      freeNavDebug('EFFECT_RUN', {
        effect: 'cargar(session-bootstrap)',
        deps: 'status,session,router',
        runCount: cargarRunCountRef.current,
        status,
        sessionRefChanged: sessionChanged,
        note: sessionChanged ? 'session object identity changed — will call lookupMateriasDesdeDB() and setMaterias() with a NEW array reference' : 'first run',
      });
      prevSessionRefForDebug.current = session;
    }
    const cargar = async () => {
      // Fase transitoria de NextAuth — todavía no sabemos si hay sesión.
      // No tocar cargando/hasBootstrappedRef aquí: no es un intento real.
      if (status === 'loading') return;

      // Solo mostrar el loading de página completa (que desmonta TODO el
      // árbol, incluida cualquier herramienta Free abierta y su generación
      // en curso) en el bootstrap inicial. Este efecto también se re-ejecuta
      // cada vez que NextAuth refresca `session` en background (focus/
      // visibilitychange) — eso es un refresco de datos, no una razón para
      // volver a mostrar el loader ni tirar abajo el árbol montado.
      if (!hasBootstrappedRef.current) setCargando(true);
      try {
        const materiasLocal = getMaterias();

        const nextUser = session?.user as any;
        if (!nextUser?.id) {
          router.push('/auth');
          return;
        }

        const uid = nextUser.id;
        setUserId(uid);

        const lastUserId = localStorage.getItem('josea_last_user');
        if (lastUserId !== uid) {
          localStorage.setItem('josea_last_user', uid);
          localStorage.removeItem('josea_perfil');
          localStorage.removeItem('josea_asignaciones');
          localStorage.removeItem('josea_objetivos');
        }

        const lookup = await lookupMateriasDesdeDB();
        if (lookup.status !== 'ERROR') {
          const restored = lookup.materias;
          if (process.env.NODE_ENV !== 'production') {
            freeNavDebug('SET_MATERIAS', {
              source: 'cargar-effect:lookupMateriasDesdeDB',
              newArrayRefWillTriggerFindAndOpenEffect: true,
              count: restored.length,
            });
          }
          setMaterias(restored);
          setMateriasRestoreStatus('READY');
          // Auto-abrir materia si viene del home (URL param o localStorage)
          try {
            const openId = openParam || localStorage.getItem('josea_open_materia');
            if (openId) {
              const mat = restored.find((m: any) => m.id === openId);
              if (mat) {
                setMateriaActual(mat);
                setVistaDebug(prev => (
                  ['flashcards', 'quiz', 'repasar', 'analisis', 'alai', 'exam', 'tema', 'apunte', 'documento'].includes(prev)
                    ? prev
                    : 'materia'
                ));
              } else {
                setVistaDebug(prev => (
                  ['flashcards', 'quiz', 'repasar', 'analisis', 'alai', 'exam', 'tema', 'apunte', 'documento'].includes(prev)
                    ? prev
                    : 'materias'
                ));
              }
              localStorage.removeItem('josea_open_materia');
            }
          } catch {}
        } else {
          // ERROR no equivale a ABSENT. El cache solo mantiene la UI usable;
          // nunca se sube ni se interpreta como autoridad durable.
          if (materiasLocal.length > 0) setMaterias(materiasLocal);
          setMateriasRestoreStatus('ERROR');
        }
      } catch (err) {
        console.error(err);
        const materiasLocal = getMaterias();
        if (materiasLocal.length > 0) setMaterias(materiasLocal);
      } finally {
        setCargando(false);
        hasBootstrappedRef.current = true;
      }
    };
    cargar();
  }, [status, session, router]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowBuscador(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const save = (m: Materia[]) => {
    setMaterias(m);
    saveMaterias(m);
  };

  const actualizarMateria = (materia: Materia) => {
    const nuevas = materias.map(m => m.id === materia.id ? materia : m);
    save(nuevas);
    setMateriaActual(materia);
  };

  const actualizarTema = (tema: Tema) => {
    if (!materiaActual) return;
    const nuevaMateria = {
      ...materiaActual,
      temas: materiaActual.temas.map(t => t.id === tema.id ? tema : t),
    };
    actualizarMateria(nuevaMateria);
    setTemaActual(tema);
  };

  const actualizarDocumento = (doc: Documento) => {
    if (!temaActual) return;
    const nuevoTema = {
      ...temaActual,
      documentos: temaActual.documentos.map(d => d.id === doc.id ? doc : d),
    };
    actualizarTema(nuevoTema);
    setDocumentoActual(doc);
  };

  const crearMateria = (data: { nombre: string; color: string; emoji: string }) => {
    const lock = `materia:${data.nombre.trim().toLocaleLowerCase()}`;
    if (createLocksRef.current.has(lock)) return;
    createLocksRef.current.add(lock);
    const nueva: Materia = {
      id: generateId(),
      nombre: data.nombre,
      color: data.color,
      emoji: data.emoji,
      temas: [],
    };
    save([...materias, nueva]);
    setModalMateria(false);
    setTimeout(() => createLocksRef.current.delete(lock), 1000);
  };

  const eliminarMateria = async (id: string) => {
    const target = materias.find(m => m.id === id);
    if (!target) return;
    if (target.temas.some(t => t.apuntes.length > 0 || t.documentos.length > 0)) {
      alert(idioma === 'en'
        ? 'Remove the notes and materials from this subject before deleting it.'
        : 'Elimina primero los apuntes y materiales de esta materia.');
      return;
    }
    try {
      await syncSessionsFromServer();
      if (target.temas.some(t => getSessionsByTema(t.id).length > 0)) {
        alert(idioma === 'en'
          ? 'This subject has study sessions and cannot be deleted safely.'
          : 'Esta materia tiene sesiones de estudio y no puede eliminarse de forma segura.');
        return;
      }
    } catch {
      alert(idioma === 'en' ? 'Could not verify dependent sessions.' : 'No se pudieron verificar las sesiones dependientes.');
      return;
    }
    if (!confirm(idioma === 'en'
      ? 'Delete this subject and all its content?'
      : '¿Eliminar esta materia y todo su contenido?')) return;
    save(materias.filter(m => m.id !== id));
  };

  const crearTema = (data: { nombre: string; color: string }) => {
    if (!materiaActual) return;
    const lock = `tema:${materiaActual.id}:${data.nombre.trim().toLocaleLowerCase()}`;
    if (createLocksRef.current.has(lock)) return;
    createLocksRef.current.add(lock);
    const nuevo: Tema = {
      id: generateId(),
      nombre: data.nombre,
      color: data.color,
      apuntes: [],
      documentos: [],
    };
    actualizarMateria({ ...materiaActual, temas: [...materiaActual.temas, nuevo] });
    setModalTema(false);
    setTimeout(() => createLocksRef.current.delete(lock), 1000);
  };

  const eliminarTema = async (id: string) => {
    if (!confirm(idioma === 'en' ? 'Delete this topic?' : '¿Eliminar este tema?')) return;
    if (!materiaActual) return;
    const target = materiaActual.temas.find(t => t.id === id);
    if (!target) return;
    if (target.apuntes.length > 0 || target.documentos.length > 0) {
      alert(idioma === 'en'
        ? 'Remove the notes and materials from this topic before deleting it.'
        : 'Elimina primero los apuntes y materiales de este tema.');
      return;
    }
    try {
      await syncSessionsFromServer(target.id);
      if (getSessionsByTema(target.id).length > 0) {
        alert(idioma === 'en'
          ? 'This topic has study sessions and cannot be deleted safely.'
          : 'Este tema tiene sesiones de estudio y no puede eliminarse de forma segura.');
        return;
      }
    } catch {
      alert(idioma === 'en' ? 'Could not verify dependent sessions.' : 'No se pudieron verificar las sesiones dependientes.');
      return;
    }
    actualizarMateria({
      ...materiaActual,
      temas: materiaActual.temas.filter(t => t.id !== id),
    });
  };

  const crearApunte = (data: { titulo: string; paperColor?: string; paperStyle?: string; paperSize?: string; scrollDirection?: 'vertical' | 'horizontal' }) => {
    if (!temaActual) return;
    // Guardar config del papel en el contenido inicial
    const paperConfig = {
      paperColor: data.paperColor || 'white',
      paperStyle: data.paperStyle || 'lined',
      paperSize: data.paperSize || 'normal',
      scrollDirection: data.scrollDirection || 'vertical',
    };
    const nuevo: Apunte = {
      id: generateId(),
      titulo: data.titulo,
      contenido: JSON.stringify({ paginas: [{ bloques: [], canvasData: null }], paperConfig }),
      fechaCreacion: new Date().toLocaleDateString(idioma === 'en' ? 'en-US' : 'es-ES'),
      fechaModificacion: new Date().toLocaleDateString(idioma === 'en' ? 'en-US' : 'es-ES'),
    };
    const nuevoTema = { ...temaActual, apuntes: [...temaActual.apuntes, nuevo] };
    actualizarTema(nuevoTema);
    setApunteActual(nuevo);
    setModalApunte(false);
    setVistaDebug('apunte');
  };

  const guardarApunte = (contenido: string) => {
    if (!apunteActual || !temaActual) return;
    const updated: Apunte = {
      ...apunteActual,
      contenido,
      fechaModificacion: new Date().toLocaleDateString(idioma === 'en' ? 'en-US' : 'es-ES'),
    };
    const nuevoTema = {
      ...temaActual,
      apuntes: temaActual.apuntes.map(a => a.id === updated.id ? updated : a),
    };
    actualizarTema(nuevoTema);
    setApunteActual(updated);
  };

  const eliminarApunte = (id: string) => {
    if (!confirm(idioma === 'en' ? 'Delete this note?' : '¿Eliminar este apunte?')) return;
    if (!temaActual) return;
    actualizarTema({
      ...temaActual,
      apuntes: temaActual.apuntes.filter(a => a.id !== id),
    });
    setVistaDebug('tema');
  };

  // ─── Nuevo sistema: abrir el uploader modal ───
  const subirDocumento = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    setShowUploader(true);
  };

  // ─── Cuando el uploader termina, agregar al tema ───
  const handleUploadComplete = (newMaterials: MaterialUI[]) => {
    if (!temaActual) return;
    const nuevosDocumentos = newMaterials.map(m => ({
      id: m.id,
      nombre: m.nombre,
      contenido: '',
      tipo: m.kind === 'image' ? 'imagen'
        : m.kind === 'docx' ? 'word'
        : m.kind === 'pptx' ? 'ppt'
        : m.kind === 'audio' ? 'audio'
        : m.kind,
      fechaSubida: new Date().toLocaleDateString('es-ES'),
      archivoUrl: undefined,
      archivoMime: undefined,
      materialId: m.id,
      text_status: m.text_status,
    }));
    actualizarTema({
      ...temaActual,
      documentos: [...temaActual.documentos, ...nuevosDocumentos],
    });
    setShowUploader(false);
  };

// Guardar video YouTube en el tema actual
const agregarYoutube = (doc: Documento) => {
  if (!temaActual) return;
  actualizarTema({ ...temaActual, documentos: [...temaActual.documentos, doc] });
};

// DESPUÉS ✅
const eliminarDocumento = async (id: string) => {
  // Sin confirm() nativo - TemaView tiene su propio modal de confirmación
  if (!temaActual) return;

  // Limpiar selecciones guardadas en localStorage para este material
  try {
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      if (k.startsWith('josea_seleccion_') && k.includes(temaActual.id)) {
        const data = localStorage.getItem(k);
        if (data) {
          try {
            const parsed = JSON.parse(data);
            if (parsed[id]) {
              delete parsed[id];
              if (Object.keys(parsed).length === 0) {
                localStorage.removeItem(k);
              } else {
                localStorage.setItem(k, JSON.stringify(parsed));
              }
            }
          } catch {}
        }
      }
    }
  } catch (e) {
    console.warn('Error limpiando selección:', e);
  }

  const doc = temaActual.documentos.find(d => d.id === id);

  // ─── Nuevo sistema: borrar por materialId ───
  const materialId = (doc as any)?.materialId;
  if (materialId) {
    try {
      const response = await fetch(`/api/materials/${materialId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`DELETE_MATERIAL_${response.status}`);
      }
    } catch (e) {
      console.warn('Error borrando material nuevo:', e);
      return;
    }
  }
  // ─── Sistema viejo: borrar por archivoUrl ───
  else if (doc?.archivoUrl && doc.archivoUrl.startsWith('http')) {
    try {
      const response = await fetch('/api/delete-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivoUrl: doc.archivoUrl }),
      });
      if (!response.ok && response.status !== 404) throw new Error(`DELETE_FILE_${response.status}`);
    } catch (e) {
      console.warn('Error borrando archivo viejo:', e);
      return;
    }
  }

  // Actualizar estado local inmediatamente (sin stale closure)
  // Usar función callback para garantizar que lee el estado más reciente
  // Capturar IDs en el momento del cierre (no son stale)
  const temaId = temaActual?.id;
  const materiaId = materiaActual?.id;

  setMaterias(prevMaterias => {
    const nuevas = prevMaterias.map(m => {
      if (!temaId || m.id !== materiaId) return m;
      return {
        ...m,
        temas: m.temas.map(t => {
          if (t.id !== temaId) return t;
          return {
            ...t,
            documentos: t.documentos.filter((d: any) => d.id !== id),
          };
        }),
      };
    });
    saveMaterias(nuevas);
    return nuevas;
  });

  // Actualizar temaActual y materiaActual FUERA del callback de setMaterias
  setTemaActual(prev => {
    if (!prev || prev.id !== temaId) return prev;
    return {
      ...prev,
      documentos: prev.documentos.filter((d: any) => d.id !== id),
    };
  });
  setMateriaActual(prev => {
    if (!prev || prev.id !== materiaId) return prev;
    return {
      ...prev,
      temas: prev.temas.map((t: any) => {
        if (t.id !== temaId) return t;
        return {
          ...t,
          documentos: t.documentos.filter((d: any) => d.id !== id),
        };
      }),
    };
  });
};

  const reordenarMaterias = (nuevasMaterias: Materia[]) => {
    setMaterias(nuevasMaterias);
    saveMaterias(nuevasMaterias);
  };

  const editarMateria = (materiaEditada: Materia) => {
    const nuevas = materias.map(m => m.id === materiaEditada.id ? materiaEditada : m);
    setMaterias(nuevas);
    saveMaterias(nuevas);
    if (materiaActual?.id === materiaEditada.id) setMateriaActual(materiaEditada);
  };

  useEffect(() => {
    if (cargando) return;

    // Nunca cambiar vista durante render. Este guard solo corrige estados rotos.
    if (['exam', 'flashcards', 'quiz', 'repasar', 'analisis', 'alai'].includes(vista)) return;

    if (vista === 'materia' && !materiaActual) {
      try { window.history.replaceState(null, '', '/materias'); } catch {}
      setVistaDebug('materias', 'broken-state-guard:vista=materia-without-materiaActual');
      return;
    }

    // Si se pierde el tema pero todavía existe materia, vuelve a la materia,
    // no al listado completo. Evita que un enfoque abierto bote al usuario.
    if (vista === 'tema' && materiaActual && !temaActual) {
      setVistaDebug('materia', 'broken-state-guard:vista=tema-without-temaActual');
      return;
    }
  }, [cargando, vista, materiaActual, temaActual]);


  if (cargando) {
    return <StudyLoader label={openParam ? 'tu materia' : 'tus materias'} />;
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {showBuscador && <Buscador onClose={() => setShowBuscador(false)} />}

      {isMobile ? (
        <NavbarMobile />
      ) : (
        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px 40px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => {
                try { (window as any).__showNavLoader?.('/'); } catch {}
                const fallback = setTimeout(() => { if (window.location.pathname !== '/') window.location.href = '/'; }, 700);
                try { router.push('/'); setTimeout(() => clearTimeout(fallback), 750); }
                catch { clearTimeout(fallback); window.location.href = '/'; }
              }}
                style={{
                  background: 'none',
                  border: '2px solid var(--gold)',
                  color: 'var(--gold)',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                ← {tr('inicio')}
              </button>
              <button
                onClick={() => setShowBuscador(true)}
                style={{
                  background: 'none',
                  border: '2px solid var(--border-color)',
                  color: 'var(--text-muted)',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                🔍 {tr('buscar')}
                <span style={{
                  fontSize: '11px',
                  background: 'var(--bg-secondary)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                }}>⌘K</span>
              </button>
            </div>
            {userId && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--text-faint)',
              }}>
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#4ade80',
                }} />
                {tr('sincronizado')}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ padding: isMobile ? '16px' : '0 40px 40px' }}>

        {(vista === 'lista' || vista === 'materias') && (
          <MateriasList
            materias={materias}
            onAbrir={(m: any) => { setMateriaActual(m); setVistaDebug('materia'); }}
            onEliminar={eliminarMateria}
            onNueva={() => setModalMateria(true)}
            onReordenar={reordenarMaterias}
            onEditar={editarMateria}
          />
        )}

        {vista === 'materia' && materiaActual && (
          <MateriaView
            materia={materiaActual}
            onBack={() => setVistaDebug('materias')}
            onAbrirTema={(t: any) => { setTemaActual(t); setVistaDebug('tema'); setAutoOpenAdaptive(false); }}
            onEliminarTema={eliminarTema}
            onNuevoTema={() => setModalTema(true)}
            onActualizarMateria={actualizarMateria}
          />
        )}

        {vista === 'tema' && temaActual && materiaActual && (
          <TemaView
            userId={userId}
            materia={materiaActual}
            tema={temaActual}
            onBack={() => setVistaDebug('materias')}
            onBackMateria={() => setVistaDebug('materia')}
            onGoHome={() => ((window as any).__showNavLoader?.('/'), router.push('/'))}
            onAbrirApunte={(a: any) => { setApunteActual(a); setVistaDebug('apunte'); }}
            onAbrirDocumento={(d: any) => { setDocumentoActual(d); setVistaDebug('documento'); }}
            onEliminarApunte={eliminarApunte}
            onEliminarDocumento={eliminarDocumento}
            onNuevoApunte={() => setModalApunte(true)}
            onSubirDocumento={subirDocumento}
            subiendoDoc={subiendoDoc}
            onAbrirUploader={() => setShowUploader(true)}
            returnToEnfoque={returnToEnfoque}
            returnSessionId={returnSessionId}
            freeReturnSeed={freeReturnSeed}
            onClearReturnToEnfoque={() => { setReturnToEnfoque(false); setReturnSessionId(null); setFreeReturnSeed(null); }}
            autoOpenAdaptive={autoOpenAdaptive}
            autoOpenAdaptiveSessionId={autoOpenAdaptiveSessionId}
            onOpenFlashcards={(mats?: any[], sel?: any[], sessionId?: string | null) => {
              const matsToUse = mats || temaActual?.documentos || [];
              const normalizedSel = normalizeSeleccionForFlashcards(sel || null, matsToUse);

              console.log('📘 Materiales para flashcards:', matsToUse);
              console.log('📑 Selección usada por flashcards:', normalizedSel);

              setFlashcardsMateriales(matsToUse);
              setFlashcardsSeleccion(normalizedSel);
              setFlashcardsSessionId(sessionId || null);
              setFreeToolSessionId(sessionId || null);
              // Inicializar mastery
              const ids = matsToUse.map((m: any) => String(m?.materialId || m?.id || '')).filter(Boolean);
              const names = matsToUse.map((m: any) => m?.nombre || m?.name || 'Material');
              initMastery(ids, names);
              setVistaDebug('flashcards', 'StudyALProcess-hub:onOpenFlashcards:user-clicked-generate');
            }}
            onOpenQuiz={(mats?: any[], sel?: any[], sessionId?: string | null) => {
              const matsToUse = mats || temaActual?.documentos || [];
              setQuizMateriales(matsToUse);
              setQuizSeleccion(sel);
              setFreeToolSessionId(sessionId || null);
              // Inicializar mastery
              const ids = matsToUse.map((m: any) => String(m?.materialId || m?.id || '')).filter(Boolean);
              const names = matsToUse.map((m: any) => m?.nombre || m?.name || 'Material');
              initMastery(ids, names);
              setVistaDebug('quiz');
            }}
            onOpenRepasar={(mats?: any[], sel?: any[], sessionId?: string | null) => {
              const matsToUse = mats || temaActual?.documentos || [];
              setRepasarMateriales(matsToUse);
              setRepasarSeleccion(Array.isArray(sel) && sel.length ? sel : null);
              setFreeToolSessionId(sessionId || null);
              // Inicializar mastery con estos materiales
              const ids = matsToUse.map((m: any) => String(m?.materialId || m?.id || '')).filter(Boolean);
              const names = matsToUse.map((m: any) => m?.nombre || m?.name || 'Material');
              initMastery(ids, names);
              setVistaDebug('repasar');
            }}
            onOpenAnalisis={(mats?: any[], sel?: any[], sessionId?: string | null) => {
              const matsToUse = mats || temaActual?.documentos || [];
              const normalizedSel = normalizeSeleccionForFlashcards(sel || null, matsToUse);
              setAnalisisMateriales(matsToUse);
              setAnalisisSeleccion(normalizedSel);
              setFreeToolSessionId(sessionId || null);
              const ids = matsToUse.map((m: any) => String(m?.materialId || m?.id || '')).filter(Boolean);
              const names = matsToUse.map((m: any) => m?.nombre || m?.name || 'Material');
              initMastery(ids, names);
              setVistaDebug('analisis');
            }}
            onOpenAlai={(mats?: any[], sel?: any[], sessionId?: string | null) => {
              const matsToUse = mats || temaActual?.documentos || [];
              const normalizedSel = normalizeSeleccionForFlashcards(sel || null, matsToUse);
              setAlaiMateriales(matsToUse);
              setAlaiSeleccion(normalizedSel);
              setFreeToolSessionId(sessionId || null);
              const ids = matsToUse.map((m: any) => String(m?.materialId || m?.id || '')).filter(Boolean);
              const names = matsToUse.map((m: any) => m?.nombre || m?.name || 'Material');
              initMastery(ids, names);
              setVistaDebug('alai');
            }}
            onOpenExam={(mats?: any[], sel?: any[], sessionId?: string | null) => {
              const matsToUse = mats || temaActual?.documentos || [];
              const normalizedSel = normalizeSeleccionForFlashcards(sel || null, matsToUse);
              setExamMateriales(matsToUse);
              setExamSeleccion(normalizedSel);
              setFreeToolSessionId(sessionId || null);
              // Inicializar mastery
              const ids = matsToUse.map((m: any) => String(m?.materialId || m?.id || '')).filter(Boolean);
              const names = matsToUse.map((m: any) => m?.nombre || m?.name || 'Material');
              initMastery(ids, names);
              setVistaDebug('exam');
            }}
            onAgregarYoutube={agregarYoutube}
            masteryState={masteryState}
            masterySnapshot={masterySnapshot}
            masteryContext={getMasteryContext()}
            onMasteryEvent={reportMasteryEvent}
            onInitMastery={initMastery}
          />
        )}

        {vista === 'apunte' && apunteActual && materiaActual && temaActual && (
          <ApunteEditor
            apunte={apunteActual}
            materia={materiaActual}
            tema={temaActual}
            onBack={() => setVistaDebug('materias')}
            onBackMateria={() => setVistaDebug('materia')}
            onBackTema={() => setVistaDebug('tema')}
            onGuardar={guardarApunte}
          />
        )}

        {vista === 'flashcards' && !(temaActual && materiaActual) && process.env.NODE_ENV !== 'production' && (() => {
          freeNavDebug('RENDER_GATE_BLOCKED', {
            gate: 'flashcards',
            reason: 'vista=flashcards but temaActual/materiaActual falsy — ALAIStudyALCards will NOT mount despite vista being flashcards',
            temaActualPresent: !!temaActual,
            materiaActualPresent: !!materiaActual,
            renderId: freeNavRenderId,
          });
          return null;
        })()}
        {vista === 'flashcards' && temaActual && materiaActual && (
          <ALAIStudyALCards
            materiales={flashcardsMateriales}
            seleccion={flashcardsSeleccion}
            tema={temaActual}
            materia={materiaActual}
            sessionId={flashcardsSessionId}
            sourceSelection={flashcardsSource}
            masteryContext={memoizedMasteryContext}
            onMasteryEvent={reportMasteryEvent}
            onBack={() => returnToFreeProcess('flashcards', flashcardsMateriales, flashcardsSeleccion, flashcardsSessionId || freeToolSessionId)}
          />
        )}

        {vista === 'quiz' && temaActual && materiaActual && (
          <ALAIStudyALQuizzes
            materiales={quizMateriales}
            seleccion={quizSeleccion}
            tema={temaActual}
            materia={materiaActual}
            sessionId={freeToolSessionId}
            sourceSelection={quizSource}
            masteryContext={memoizedMasteryContext}
            onMasteryEvent={reportMasteryEvent}
            onBack={() => {
              returnToFreeProcess('quiz', quizMateriales, quizSeleccion, freeToolSessionId);
              setQuizMateriales([]);
              setQuizSeleccion(undefined);
            }}
          />
        )}

        {vista === 'repasar' && temaActual && materiaActual && (
          <ALAIStudyALRepasar
            materiales={repasarMateriales}
            seleccion={repasarSeleccion}
            tema={temaActual}
            materia={materiaActual}
            sessionId={freeToolSessionId}
            sourceSelection={repasarSource}
            masteryContext={memoizedMasteryContext}
            onMasteryEvent={reportMasteryEvent}
            onBack={() => returnToFreeProcess('repasar', repasarMateriales, repasarSeleccion, freeToolSessionId)}
          />
        )}

        {vista === 'analisis' && temaActual && materiaActual && (
          <AnalisisTeorico
            materiales={analisisMateriales}
            seleccion={analisisSeleccion}
            tema={temaActual}
            materia={materiaActual}
            sessionId={freeToolSessionId}
            sourceSelection={analisisSource}
            masteryContext={memoizedMasteryContext}
            onMasteryEvent={reportMasteryEvent}
            onClose={() => returnToFreeProcess('analisis', analisisMateriales, analisisSeleccion, freeToolSessionId)}
          />
        )}

        {vista === 'alai' && temaActual && materiaActual && (
          <ALAIStudyALChat
            materiales={alaiMateriales}
            seleccion={alaiSeleccion}
            tema={temaActual}
            materia={materiaActual}
            sessionId={freeToolSessionId}
            sourceSelection={alaiSource}
            masteryContext={memoizedMasteryContext}
            onMasteryEvent={reportMasteryEvent}
            onBack={() => returnToFreeProcess('alai', alaiMateriales, alaiSeleccion, freeToolSessionId)}
          />
        )}


        {vista === 'exam' && temaActual && materiaActual && (
          <ALAIStudyALExams
            materiales={examMateriales}
            seleccion={examSeleccion}
            tema={temaActual}
            materia={materiaActual}
            sessionId={freeToolSessionId}
            sourceSelection={examSource}
            userName={(session?.user as any)?.name || (session?.user as any)?.username || ''}
            masteryContext={memoizedMasteryContext}
            onMasteryEvent={reportMasteryEvent}
            onBack={() => returnToFreeProcess('examen', examMateriales, examSeleccion, freeToolSessionId)}
          />
        )}

        {vista === 'documento' && documentoActual && materiaActual && temaActual && (
          <DocumentoView
            documento={documentoActual}
            materia={materiaActual}
            tema={temaActual}
            onBack={() => setVistaDebug('materias')}
            onBackMateria={() => setVistaDebug('materia')}
            onBackTema={() => setVistaDebug('tema')}
            onActualizar={actualizarDocumento}
          />
        )}

        {/* ─── Modal Upload nuevo sistema ─── */}
        {showUploader && temaActual && materiaActual && (
          <div
            onClick={() => setShowUploader(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 99999,
              background: 'rgba(0,0,0,0.85)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
            }}
          >
            <div onClick={(e) => e.stopPropagation()}>
              <MaterialUploader
                temaId={temaActual.id}
                materiaId={materiaActual.id}
                onUploadComplete={handleUploadComplete}
                onClose={() => setShowUploader(false)}
              />
            </div>
          </div>
        )}

        {modalMateria && (
          <ModalMateria
            onClose={() => setModalMateria(false)}
            onConfirm={crearMateria}
          />
        )}
        {modalTema && materiaActual && (
          <ModalTema
            onClose={() => setModalTema(false)}
            onConfirm={crearTema}
            colorMateria={materiaActual.color}
          />
        )}
        {/* Session Summary Modal */}
        {summaryVisible && sessionSummary && (
          <div
            onClick={() => setSummaryVisible(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 99999,
              background: 'rgba(0,0,0,0.75)',
              backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 20,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: 'min(500px, 100%)',
                background: 'var(--bg-card)',
                border: '2px solid var(--gold)',
                borderRadius: 18,
                padding: 22,
                boxShadow: '0 24px 80px rgba(0,0,0,.5)',
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--gold)', marginBottom: 4 }}>
                ✅ Sesión completada
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 16, fontWeight: 700 }}>
                {sessionSummary.tool.toUpperCase()} · {new Date(sessionSummary.timestamp).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
              </div>

              {Object.keys(sessionSummary.dimensionGains).length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    LO QUE SUBIÓ HOY
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {Object.entries(sessionSummary.dimensionGains).map(([dim, gain]) => {
                      if (!gain || gain <= 0) return null;
                      const dimLabels: any = { understanding: 'Comprensión', memory: 'Memoria', application: 'Aplicación', explanation: 'Explicación', exam: 'Examen' };
                      return (
                        <div key={dim} style={{
                          padding: '5px 10px', borderRadius: 20,
                          background: 'rgba(74,222,128,0.12)',
                          border: '1px solid rgba(74,222,128,0.3)',
                          fontSize: 11, fontWeight: 800, color: '#4ade80',
                        }}>
                          {dimLabels[dim]} +{gain}%
                        </div>
                      );
                    })}
                    {sessionSummary.overallGain > 0 && (
                      <div style={{
                        padding: '5px 10px', borderRadius: 20,
                        background: 'rgba(214,178,111,0.15)',
                        border: '1px solid rgba(214,178,111,0.4)',
                        fontSize: 11, fontWeight: 900, color: 'var(--gold)',
                      }}>
                        Dominio total +{sessionSummary.overallGain}%
                      </div>
                    )}
                  </div>
                </div>
              )}

              {sessionSummary.conceptsImproved.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    CONCEPTOS QUE MEJORARON
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {sessionSummary.conceptsImproved.map(c => (
                      <span key={c} style={{
                        padding: '4px 9px', borderRadius: 20,
                        background: 'rgba(74,222,128,0.08)',
                        border: '1px solid rgba(74,222,128,0.25)',
                        fontSize: 11, fontWeight: 700, color: '#4ade80',
                      }}>{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {sessionSummary.conceptsStillWeak.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    TODAVÍA REQUIERE TRABAJO
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {sessionSummary.conceptsStillWeak.map(c => (
                      <span key={c} style={{
                        padding: '4px 9px', borderRadius: 20,
                        background: 'rgba(249,115,22,0.08)',
                        border: '1px solid rgba(249,115,22,0.25)',
                        fontSize: 11, fontWeight: 700, color: '#f97316',
                      }}>{c}</span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{
                padding: '10px 14px', borderRadius: 10,
                background: 'rgba(214,178,111,0.08)',
                border: '1px solid rgba(214,178,111,0.25)',
                marginBottom: 16,
                fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45,
              }}>
                <strong style={{ color: 'var(--gold)', fontWeight: 900 }}>Siguiente paso: </strong>
                {sessionSummary.nextRecommendedTool.toUpperCase()}
                {sessionSummary.nextRecommendedConcept && ` · enfócate en "${sessionSummary.nextRecommendedConcept}"`}
              </div>

              <button
                onClick={() => setSummaryVisible(false)}
                style={{
                  width: '100%', padding: '12px',
                  borderRadius: 12, border: '2px solid var(--gold)',
                  background: 'var(--gold)', color: '#111',
                  fontWeight: 900, fontSize: 14, cursor: 'pointer',
                }}
              >
                Continuar →
              </button>
            </div>
          </div>
        )}

        {modalApunte && temaActual && (
          <ModalApunte
            onClose={() => setModalApunte(false)}
            onConfirm={crearApunte}
            colorTema={temaActual.color}
          />
        )}
      </div>
    </div>
  );
}
