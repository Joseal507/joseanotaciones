'use client'

import TemaView from '../../components/materias/TemaView'

// Phase 5 Blocker 4 / Phase 6: real materials distinct from the 30-page fixture in
// app/e2e-page-study/page.tsx, so the adaptive block-size UI and session-lifecycle discovery can
// be exercised live in a browser without touching that other fixture (used by the existing
// page-study-phase4 E2E spec, which assumes 7 uniformly 30-page materials).
const documentos = [
  { id: 'pdf-1', materialId: 'pdf-1', nombre: 'Atlanta Falcons — historia.pdf', extension: 'pdf', kind: 'pdf', upload_status: 'uploaded', text_status: 'ready', pages_count: 2 },
  // Phase 6D: a SEPARATE material record representing the "same PDF content, re-uploaded" case —
  // a different materialId must never inherit pdf-1's Page Study session.
  { id: 'pdf-2', materialId: 'pdf-2', nombre: 'Atlanta Falcons — historia (copia).pdf', extension: 'pdf', kind: 'pdf', upload_status: 'uploaded', text_status: 'ready', pages_count: 2 },
  { id: 'pdf-3', materialId: 'pdf-3', nombre: 'Material 20 páginas.pdf', extension: 'pdf', kind: 'pdf', upload_status: 'uploaded', text_status: 'ready', pages_count: 20 },
  { id: 'pdf-4', materialId: 'pdf-4', nombre: 'Material 50 páginas.pdf', extension: 'pdf', kind: 'pdf', upload_status: 'uploaded', text_status: 'ready', pages_count: 50 },
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
