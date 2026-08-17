'use client';

// Harness visual-only para revisar la iluminación del triángulo Manual
// (P1). Renderiza StudyALManualProcess directamente con un progressByTool
// construido desde query params, para poder probar cada combinación de
// herramientas completas sin tener que simular la interacción real con
// las 6 herramientas (generación de flashcards, exámenes, etc).
// Uso: ?leer=15&alai=10&examen=15&flashcards=20&quizzes=20&resumen=20
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import StudyALManualProcess from '../../components/materias/StudyALManualProcess';
import { MANUAL_TOOL_CAPS, MANUAL_TOOL_IDS, type DurableManualTool } from '../../lib/manualToolState';
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';

const materiales = [{ id: 'mat-visual-1', materialId: 'mat-visual-1', nombre: 'Material de ejemplo' }];
const sourceSelection = buildSourceSelectionSnapshot(['mat-visual-1'], { 'mat-visual-1': [] });

function Harness() {
  const params = useSearchParams();
  const progressByTool: Partial<Record<DurableManualTool, number>> = {};
  for (const tool of MANUAL_TOOL_IDS) {
    const raw = params.get(tool);
    if (raw != null) progressByTool[tool] = Math.min(MANUAL_TOOL_CAPS[tool], Number(raw) || 0);
  }

  return (
    <StudyALManualProcess
      materiales={materiales}
      temaId="tema-visual"
      sessionId="session-visual"
      sourceSelection={sourceSelection}
      onClose={() => {}}
      onOpenLeer={() => {}}
      onOpenAlai={() => {}}
      onOpenFlashcards={() => {}}
      onOpenQuizzes={() => {}}
      onOpenResumen={() => {}}
      onOpenExamen={() => {}}
      progressByTool={progressByTool}
    />
  );
}

export default function VisualP1ManualHarness() {
  return (
    <Suspense fallback={null}>
      <Harness />
    </Suspense>
  );
}
