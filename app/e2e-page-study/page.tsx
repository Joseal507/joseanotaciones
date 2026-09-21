'use client'

import TemaView from '../../components/materias/TemaView'

const documentos = Array.from({ length: 7 }, (_, index) => ({
  id: `pdf-${index + 1}`,
  materialId: `pdf-${index + 1}`,
  nombre: index === 0
    ? 'Química Orgánica — nomenclatura, reacciones y mecanismos.pdf'
    : `Material ${index + 1}.pdf`,
  extension: 'pdf',
  kind: 'pdf',
  upload_status: 'uploaded',
  text_status: 'ready',
  pages_count: 30,
}))

export default function PageStudyE2EHarness() {
  return (
    <TemaView
      materia={{ id: 'materia-page-study-e2e', nombre: 'Química', color: '#38bdf8' }}
      tema={{ id: 'tema-page-study-e2e', nombre: 'Examen final', color: '#38bdf8', apuntes: [], documentos }}
      userId="page-study-e2e-user"
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
