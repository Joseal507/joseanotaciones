'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import StudyALProcess from './StudyALProcess'
import { buildInitialStudyPlan } from '../../lib/adaptive/planner/initialPlanner'
import { adaptStudyPlanToSessions } from '../../lib/adaptive/planner/adaptStudyPlanToSessions'
import type { AdaptiveProgram } from '../../lib/adaptive'
import type { AssessmentMode, ExamFormat } from '../../lib/adaptive/planner/types'

export default function AdaptiveProductRealFixture() {
  const params = useSearchParams()
  const fixture = useMemo(() => {
    const materialId = 'fixture_material'
    const now = new Date()
    const exam = new Date(now.getTime() + Number(params.get('days') || 7) * 86_400_000)
    const assessmentMode = (params.get('mode') || 'mix_everything') as AssessmentMode
    const examFormat = (params.get('exam') || 'mixed') as ExamFormat
    const dailyMinutes = Number(params.get('minutes') || 45)
    const micros = Array.from({ length: Number(params.get('micros') || 9) }, (_, index) => ({
      id: `fixture_micro_${index + 1}`, name: ['Estructura atómica', 'Evidencia experimental', 'Modelo explicativo', 'Niveles de energía', 'Radiación y espectros', 'Interpretación científica', 'Aplicaciones del modelo', 'Límites de la teoría', 'Legado científico'][index] || `Tema académico ${index + 1}`, difficulty: .4 + index * .03,
      importance: index < 3 ? 'high' as const : 'medium' as const, cognitiveType: 'conceptual',
    }))
    const plan = buildInitialStudyPlan({ materialId, micros, now, setup: {
      initialLevel: 'zero', sessionLength: 'medium', examAt: exam.toISOString(), targetScore: 90,
      assessmentMode, examFormat, availability: { dailyMinutes, availableDays: [0,1,2,3,4,5,6] }, priorities: [],
    } })
    const sessions = adaptStudyPlanToSessions(plan)
    const program = {
      id: 'fixture_program', materialId, graphMicroIds: micros.map(m => m.id), createdAt: now.getTime(), updatedAt: now.getTime(), materialIds: [materialId],
      setup: { initialKnowledgeLevel: 'zero' as const, sessionLength: 'medium' as const, targetScore: 90, examDate: null, examDateTime: exam.toISOString(), examFormat, evalPreference: assessmentMode, dailyMinutes },
      status: 'active' as const, sessions, currentSessionIndex: 0, studyPlan: plan,
      materialBlueprint: { topics: [{ id: 'topic', title: 'Fundamentos', conceptNames: ['Modelo atómico'] }] },
    } satisfies AdaptiveProgram & { materialId: string; graphMicroIds: string[] }
    return { material: { id: materialId, materialId, nombre: 'Material determinista de integración', kind: 'pdf', contenido: 'Contenido pedagógico determinista sobre estructura atómica. '.repeat(20) }, program }
  }, [params])
  const noop = () => {}
  return <StudyALProcess materiales={[fixture.material]} temaId="fixture_tema" initialMode="adaptive" userId="fixture_user" masteryState={{ materialId: fixture.material.materialId, sessionKey: 'fixture_session', processMode: 'adaptive', processStyle: 'book', adaptiveProgram: fixture.program, materialBlueprint: fixture.program.materialBlueprint }} onClose={noop} onOpenFlashcards={noop} onOpenQuiz={noop} onComingSoon={noop} />
}
