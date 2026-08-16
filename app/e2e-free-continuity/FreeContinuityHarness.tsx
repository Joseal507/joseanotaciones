'use client';

import { useEffect, useMemo, useState } from 'react';
import ALAIStudyALQuizzes from '../../components/materias/ALAIStudyALQuizzes';
import ALAIStudyALExams from '../../components/materias/ALAIStudyALExams';
import ALAIStudyALCards from '../../components/materias/ALAIStudyALCards';
import ALAIStudyALRepasar from '../../components/materias/ALAIStudyALRepasar';
import ALAIStudyALChat from '../../components/materias/ALAIStudyALChat';
import AnalisisTeorico from '../../components/materias/AnalisisTeorico';
import ALAIStudyMap from '../../components/materias/ALAIStudyMap';
import ALAIStudyALCheatCodes from '../../components/materias/ALAIStudyALCheatCodes';
import StudyALProcess from '../../components/materias/StudyALProcess';
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';
import { getSessionById, lookupSessionsFromServer, upsertSession } from '../../lib/studySessions';

const sessionId = 'e2e-free-tool-continuity';
const sourceSelection = buildSourceSelectionSnapshot(
  ['e2e-free-a', 'e2e-free-b'],
  { 'e2e-free-a': [2, 5], 'e2e-free-b': [1, 7] },
);
const materials = [
  { id: 'e2e-free-a', materialId: 'e2e-free-a', nombre: 'Material A' },
  { id: 'e2e-free-b', materialId: 'e2e-free-b', nombre: 'Material B' },
];

// ── Whole-document scenario (P0 regression harness) ──
// Reproduces the exact real-world precondition: an explicit pages-[1,2]
// Free session already exists for a material, and the user then opens
// Free again choosing "documento completo" for that SAME material. Used
// via ?wholedoc=1 — a single material, no explicit page selection.
const wholeDocMaterialId = 'e2e-wholedoc-mat';
const wholeDocTemaId = 'e2e-wholedoc-tema';
const wholeDocPagesSelection = buildSourceSelectionSnapshot([wholeDocMaterialId], { [wholeDocMaterialId]: [1, 2] });
const wholeDocSourceSelection = buildSourceSelectionSnapshot([wholeDocMaterialId], {});
const wholeDocMaterials = [
  { id: wholeDocMaterialId, materialId: wholeDocMaterialId, nombre: 'Material Whole Doc' },
];

type ActiveTool = 'hub' | 'quiz' | 'exam' | 'flashcards' | 'repasar' | 'alai' | 'analysis' | 'studymap' | 'truquitos';

export default function FreeContinuityHarness() {
  const [ready, setReady] = useState(false);
  const [activeTool, setActiveTool] = useState<ActiveTool>('hub');
  const [wholeDocSessionId, setWholeDocSessionId] = useState<string | null>(null);

  const isWholeDoc = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('wholedoc') === '1';
  }, []);

  const analysisLevel = useMemo(() => {
    if (typeof window === 'undefined') return 'universidad' as const;
    const requested = new URLSearchParams(window.location.search).get('level');
    return requested === 'secundaria' || requested === 'medicina' || requested === 'doctorado'
      ? requested
      : 'universidad';
  }, []);

  const initialTool = useMemo((): ActiveTool => {
    if (typeof window === 'undefined') return 'hub';
    const requested = new URLSearchParams(window.location.search).get('tool');
    if (requested === 'hub') return 'hub';
    if (['exam', 'flashcards', 'repasar', 'alai', 'analysis', 'studymap', 'truquitos', 'quiz'].includes(requested || '')) {
      return requested as ActiveTool;
    }
    return 'hub';
  }, []);

  useEffect(() => {
    setActiveTool(initialTool);
  }, [initialTool]);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (isWholeDoc) {
        // Reproduce the exact real-bug precondition: an explicit pages-[1,2]
        // Free session already exists for this material BEFORE the user
        // opens Free again choosing "documento completo".
        let pagesSession = getSessionById('e2e-wholedoc-pages-session');
        if (!pagesSession) {
          pagesSession = upsertSession({
            id: 'e2e-wholedoc-pages-session',
            temaId: wholeDocTemaId,
            enfoque: 'teorico',
            processMode: 'free',
            materialIds: wholeDocPagesSelection.materialIds,
            materialNames: ['Material Whole Doc'],
            selectedPages: wholeDocPagesSelection.selectedPages,
          });
        }
        // Now open Free again for "documento completo" — no explicit
        // selectedPages, exactly like TemaView.tsx's ensureFreeSessionForTool.
        const wholeDocSession = upsertSession({
          temaId: wholeDocTemaId,
          enfoque: 'teorico',
          processMode: 'free',
          materialIds: wholeDocSourceSelection.materialIds,
          materialNames: ['Material Whole Doc'],
        });
        if (!cancelled) {
          setWholeDocSessionId(wholeDocSession.id);
          setReady(true);
        }
        return;
      }
      let existing = getSessionById(sessionId);
      if (!existing) {
        await lookupSessionsFromServer('e2e-free-tema', sessionId);
        existing = getSessionById(sessionId);
      }
      if (!existing) {
        upsertSession({
          id: sessionId,
          temaId: 'e2e-free-tema',
          enfoque: 'teorico',
          processMode: 'free',
          materialIds: sourceSelection.materialIds,
          materialNames: ['Material A', 'Material B'],
          selectedPages: sourceSelection.selectedPages,
        });
      }
      if (!cancelled) setReady(true);
    }
    void restore();
    return () => { cancelled = true; };
  }, [isWholeDoc]);

  if (!ready) return <div data-testid="free-continuity-loading">Preparando sesión</div>;

  const goBack = () => setActiveTool('hub');

  const shared = isWholeDoc
    ? {
        materiales: wholeDocMaterials,
        seleccion: wholeDocSourceSelection.materials.map(item => ({ materialId: item.materialId, pages: item.selectedPages })),
        tema: { id: wholeDocTemaId, nombre: 'Tema E2E Whole Doc' },
        materia: { id: 'e2e-free-materia', nombre: 'Materia E2E' },
        sessionId: wholeDocSessionId || '',
        sourceSelection: wholeDocSourceSelection,
        onBack: goBack,
      }
    : {
        materiales: materials,
        seleccion: sourceSelection.materials.map(item => ({ materialId: item.materialId, pages: item.selectedPages })),
        tema: { id: 'e2e-free-tema', nombre: 'Tema E2E' },
        materia: { id: 'e2e-free-materia', nombre: 'Materia E2E' },
        sessionId,
        sourceSelection,
        onBack: goBack,
      };

  if (activeTool === 'exam') return <ALAIStudyALExams {...shared} userName="Estudiante E2E" />;
  if (activeTool === 'flashcards') return <ALAIStudyALCards {...shared} />;
  if (activeTool === 'repasar') return <ALAIStudyALRepasar {...shared} />;
  if (activeTool === 'alai') return <ALAIStudyALChat {...shared} />;
  if (activeTool === 'analysis') return <AnalisisTeorico {...shared} nivel={analysisLevel} onClose={goBack} />;
  if (activeTool === 'studymap') return <ALAIStudyMap {...shared} />;
  if (activeTool === 'truquitos') return <ALAIStudyALCheatCodes {...shared} />;
  if (activeTool !== 'hub') return <ALAIStudyALQuizzes {...shared} />;

  // HUB mode: mount real StudyALProcess
  return (
    <div data-testid="free-hub-container" style={{ position: 'fixed', inset: 0 }}>
      <div data-testid="session-id" style={{ display: 'none' }}>{sessionId}</div>
      <div data-testid="source-fingerprint" style={{ display: 'none' }}>{sourceSelection.fingerprint}</div>
      <div data-testid="selected-pages" style={{ display: 'none' }}>
        {JSON.stringify(sourceSelection.selectedPages)}
      </div>
      <StudyALProcess
        materiales={materials}
        temaId="e2e-free-tema"
        enfoque="teorico"
        sessionId={sessionId}
        sourceSelection={sourceSelection}
        onClose={goBack}
        onOpenFlashcards={() => setActiveTool('flashcards')}
        onOpenQuiz={() => setActiveTool('quiz')}
        onOpenRepasar={() => setActiveTool('repasar')}
        onOpenAnalisis={() => setActiveTool('analysis')}
        onOpenAlai={() => setActiveTool('alai')}
        onOpenExam={() => setActiveTool('exam')}
        onOpenStudyMap={() => setActiveTool('studymap')}
        onOpenCheatCodes={() => setActiveTool('truquitos')}
        onComingSoon={() => {}}
      />
    </div>
  );
}
