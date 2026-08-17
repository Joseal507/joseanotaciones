'use client';

// Harness visual-only para revisar cohesión visual (TemaView / Leaderboard /
// Quiz / Truquitos / Análisis) fuera del flujo real de auth+datos. No prueba
// lógica ni persistencia -- monta los componentes con props/mocks mínimos
// para inspeccionar el shell visual en distintos temas/paletas.
// Uso: ?surface=temaview|leaderboard|quiz|truquitos|analisis
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import TemaView from '../../components/materias/TemaView';
import Leaderboard from '../../components/Leaderboard';
import ALAIStudyALQuizzes from '../../components/materias/ALAIStudyALQuizzes';
import ALAIStudyALCheatCodes from '../../components/materias/ALAIStudyALCheatCodes';
import AnalisisTeorico from '../../components/materias/AnalisisTeorico';

const materia = { id: 'materia-visual', nombre: 'Materia de ejemplo', color: '#38bdf8' };
const tema = {
  id: 'tema-visual',
  nombre: 'Tema de ejemplo',
  materiaId: 'materia-visual',
  apuntes: [],
  documentos: [
    { id: 'doc-1', nombre: 'Apuntes de clase.pdf', tipo: 'pdf', fecha: Date.now() },
    { id: 'doc-2', nombre: 'Resumen del capítulo', tipo: 'apunte', fecha: Date.now() },
  ],
};

const materiales = [
  { id: 'doc-1', materialId: 'doc-1', nombre: 'Apuntes de clase.pdf', tipo: 'pdf' },
];

function Harness() {
  const surface = useSearchParams().get('surface') || 'temaview';

  if (surface === 'leaderboard') {
    return <Leaderboard />;
  }

  if (surface === 'quiz') {
    return (
      <ALAIStudyALQuizzes
        materiales={materiales}
        seleccion={null}
        tema={tema}
        materia={materia}
        onBack={() => {}}
        sessionId="visual-harness"
      />
    );
  }

  if (surface === 'truquitos') {
    return (
      <ALAIStudyALCheatCodes
        materiales={materiales}
        seleccion={null}
        tema={tema}
        materia={materia}
        onBack={() => {}}
        sessionId="visual-harness"
      />
    );
  }

  if (surface === 'analisis') {
    return (
      <AnalisisTeorico
        materiales={materiales}
        seleccion={null}
        tema={tema}
        materia={materia}
        onClose={() => {}}
        sessionId="visual-harness"
      />
    );
  }

  return (
    <TemaView
      materia={materia}
      tema={tema}
      onBack={() => {}}
      onBackMateria={() => {}}
      onGoHome={() => {}}
      onAbrirApunte={() => {}}
      onAbrirDocumento={() => {}}
      onEliminarApunte={() => {}}
      onEliminarDocumento={() => {}}
      onNuevoApunte={() => {}}
      onSubirDocumento={() => {}}
      subiendoDoc={false}
      onAbrirUploader={() => {}}
      onOpenFlashcards={() => {}}
      onOpenQuiz={() => {}}
      onOpenRepasar={() => {}}
      onOpenAnalisis={() => {}}
      onOpenAlai={() => {}}
      onOpenExam={() => {}}
    />
  );
}

export default function VisualP1Harness() {
  return (
    <Suspense fallback={null}>
      <Harness />
    </Suspense>
  );
}
