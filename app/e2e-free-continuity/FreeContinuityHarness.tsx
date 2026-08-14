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

export default function FreeContinuityHarness() {
  const [ready, setReady] = useState(false);
  const analysisLevel = useMemo(() => {
    if (typeof window === 'undefined') return 'universidad' as const;
    const requested = new URLSearchParams(window.location.search).get('level');
    return requested === 'secundaria' || requested === 'medicina' || requested === 'doctorado'
      ? requested
      : 'universidad';
  }, []);
  const tool = useMemo(() => {
    if (typeof window === 'undefined') return 'quiz';
    const requested = new URLSearchParams(window.location.search).get('tool');
    return ['exam', 'flashcards', 'repasar', 'alai', 'analysis', 'studymap', 'truquitos'].includes(requested || '') ? requested : 'quiz';
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
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
  }, []);

  if (!ready) return <div data-testid="free-continuity-loading">Preparando sesión</div>;
  const shared = {
    materiales: materials,
    seleccion: sourceSelection.materials.map(item => ({ materialId: item.materialId, pages: item.selectedPages })),
    tema: { id: 'e2e-free-tema', nombre: 'Tema E2E' },
    materia: { id: 'e2e-free-materia', nombre: 'Materia E2E' },
    sessionId,
    sourceSelection,
    onBack: () => {},
  };
  if (tool === 'exam') return <ALAIStudyALExams {...shared} userName="Estudiante E2E" />;
  if (tool === 'flashcards') return <ALAIStudyALCards {...shared} />;
  if (tool === 'repasar') return <ALAIStudyALRepasar {...shared} />;
  if (tool === 'alai') return <ALAIStudyALChat {...shared} />;
  if (tool === 'analysis') return <AnalisisTeorico {...shared} nivel={analysisLevel} onClose={() => {}} />;
  if (tool === 'studymap') return <ALAIStudyMap {...shared} />;
  if (tool === 'truquitos') return <ALAIStudyALCheatCodes {...shared} />;
  return <ALAIStudyALQuizzes {...shared} />;
}
