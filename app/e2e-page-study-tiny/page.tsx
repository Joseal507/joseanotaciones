'use client'

import TemaView from '../../components/materias/TemaView'

// Phase 5 Blocker 4: a real 2-page material, distinct from the 30-page fixture in
// app/e2e-page-study/page.tsx, so the adaptive block-size ("mode: 'full'") UI path can be
// exercised live in a browser without touching that other fixture (used by the existing
// page-study-phase4 E2E spec, which assumes 7 uniformly 30-page materials).
const documentos = [
  {
    id: 'pdf-1',
    materialId: 'pdf-1',
    nombre: 'Atlanta Falcons — historia.pdf',
    extension: 'pdf',
    kind: 'pdf',
    upload_status: 'uploaded',
    text_status: 'ready',
    pages_count: 2,
  },
]

export default function PageStudyTinyE2EHarness() {
  return (
    <TemaView
      materia={{ id: 'materia-page-study-tiny-e2e', nombre: 'Historia', color: '#38bdf8' }}
      tema={{ id: 'tema-page-study-tiny-e2e', nombre: 'Falcons', color: '#38bdf8', apuntes: [], documentos }}
      userId="page-study-tiny-e2e-user"
      onBack={() => {}}
      onBackMateria={() => {}}
      onGoHome={() => {}}
      onAbrirApunte={() => {}}
      onAbrirDocumento={() => {}}
      onEliminarApunte={() => {}}
      onEliminarDocumento={() => {}}
      onNuevoApunte={() => {}}
      onSubirDocumento={() => {}}
      onAbrirUploader={() => {}}
      onOpenFlashcards={() => {}}
      onOpenQuiz={() => {}}
      onOpenRepasar={() => {}}
      onOpenAnalisis={() => {}}
      onOpenAlai={() => {}}
      onOpenExam={() => {}}
    />
  )
}
