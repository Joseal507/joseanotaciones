'use client';

// Harness visual-only para revisar P1 (TemaView / Leaderboard) fuera del
// flujo real de auth+datos. No prueba lógica ni persistencia -- monta los
// componentes con props/mocks mínimos para inspeccionar el shell visual en
// distintos temas/paletas. Uso: ?surface=temaview|leaderboard
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import TemaView from '../../components/materias/TemaView';
import Leaderboard from '../../components/Leaderboard';

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

function Harness() {
  const surface = useSearchParams().get('surface') || 'temaview';

  if (surface === 'leaderboard') {
    return <Leaderboard />;
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
