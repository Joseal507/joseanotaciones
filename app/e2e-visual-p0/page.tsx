'use client';

// Harness visual-only para revisar P0 (Adaptive / Manual / Flashcards) fuera
// del flujo real de auth+datos. No prueba lógica ni persistencia -- monta
// los 3 componentes con props mínimas para inspeccionar el shell visual en
// distintos temas/paletas. Uso: ?surface=adaptive|manual|cards
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import StudyALAdaptive from '../../components/materias/StudyALAdaptive';
import StudyALManualProcess from '../../components/materias/StudyALManualProcess';
import ALAIStudyALCards from '../../components/materias/ALAIStudyALCards';
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';

const materiales = [{ id: 'mat-visual-1', materialId: 'mat-visual-1', nombre: 'Material de ejemplo' }];
const tema = { id: 'tema-visual', nombre: 'Tema de ejemplo' };
const materia = { id: 'materia-visual', nombre: 'Materia de ejemplo' };
const sourceSelection = buildSourceSelectionSnapshot(['mat-visual-1'], { 'mat-visual-1': [] });

function Harness() {
  const surface = useSearchParams().get('surface') || 'adaptive';

  if (surface === 'manual') {
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
        progressByTool={{ leer: 2, alai: 1, flashcards: 0, quizzes: 0, resumen: 0, examen: 0 }}
      />
    );
  }

  if (surface === 'cards') {
    return (
      <ALAIStudyALCards
        materiales={materiales}
        tema={tema}
        materia={materia}
        sessionId="session-visual"
        onBack={() => {}}
        sourceSelection={sourceSelection}
      />
    );
  }

  return (
    <StudyALAdaptive
      materiales={materiales}
      temaId="tema-visual"
      onClose={() => {}}
    />
  );
}

export default function VisualP0Harness() {
  return (
    <Suspense fallback={null}>
      <Harness />
    </Suspense>
  );
}
