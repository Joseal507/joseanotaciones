'use client'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { buildInitialStudyPlan } from '../../lib/adaptive/planner/initialPlanner'
import { reviseStudyPlan } from '../../lib/adaptive/planRevision/reviseStudyPlan'
import { calculateExamReadiness } from '../../lib/adaptive/readiness/calculateReadiness'
import type { AssessmentMode, ExamFormat, StudyPlan } from '../../lib/adaptive/planner/types'

const NOW = new Date('2026-07-16T12:00:00.000Z')
export default function PlannerHarness() {
  const params = useSearchParams()
  const days = Number(params.get('days') || 7)
  const count = Number(params.get('micros') || 12)
  const mode = (params.get('mode') || 'mix_everything') as AssessmentMode
  const examFormat = (params.get('exam') || 'mixed') as ExamFormat
  const minutes = Number(params.get('minutes') || 45)
  const material = params.get('material') || 'Niels Bohr'
  const initial = useMemo(() => buildInitialStudyPlan({ materialId: material, now: NOW, micros: Array.from({ length: count }, (_, i) => ({ id: `micro-${i}`, difficulty: i < 3 ? .9 : .45, importance: i < 3 ? 'critical' as const : 'medium' as const, cognitiveType: i % 3 ? 'conceptual' : 'procedural' })), setup: { initialLevel: 'zero', sessionLength: 'medium', examAt: new Date(NOW.getTime() + days * 86_400_000).toISOString(), targetScore: Number(params.get('score') || 90), assessmentMode: mode, examFormat, availability: { dailyMinutes: minutes, availableDays: [0,1,2,3,4,5,6] }, priorities: [] } }), [days, count, mode, examFormat, minutes, material, params])
  const [plan, setPlan] = useState<StudyPlan>(initial)
  const [mastered, setMastered] = useState<string[]>([])
  const [studied, setStudied] = useState<string[]>([])
  const [paused, setPaused] = useState(false)
  const readiness = calculateExamReadiness({ requiredMicroIds: plan.requiredMicroIds, studiedMicroIds: studied, masteredMicroIds: mastered, transferReadyMicroIds: mastered, examFormat })
  const next = plan.sessions.find(s => s.status !== 'completed')
  const revise = (kind: 'fast'|'repair'|'missed'|'date') => setPlan(current => reviseStudyPlan(current, { now: NOW, completedSessionId: kind === 'missed' ? undefined : next?.sessionId, masteredMicroIds: kind === 'fast' ? current.requiredMicroIds.slice(0, 4) : mastered, unresolvedMicroIds: kind === 'repair' ? current.requiredMicroIds.slice(0, 2) : [], actualMinutes: kind === 'fast' ? 5 : 22, confidenceAverage: 70, assistanceRate: kind === 'repair' ? .8 : 0, missedSessionIds: kind === 'missed' && next ? [next.sessionId] : [], newExamAt: kind === 'date' ? new Date(NOW.getTime() + 14 * 86_400_000).toISOString() : undefined }))
  return <main data-testid="planner" data-feasibility={plan.feasibility.level} data-mode={mode} data-exam-format={examFormat} data-revision={plan.revisionVersion} data-program-complete={String(readiness.isProgramComplete)} style={{ maxWidth: 760, margin: '30px auto', padding: 24, fontFamily: 'system-ui' }}>
    <h1>Tu plan de estudio · {material}</h1>
    <section data-testid="next-session" aria-label="Tu próxima sesión" style={{ border: '2px solid #d6b26f', borderRadius: 14, padding: 18 }}>
      <strong>Tu próxima sesión</strong><h2>{next?.objective}</h2><p data-testid="duration">{next?.plannedDuration} minutos</p><p data-testid="reason">{next?.reason}</p><button disabled={paused}>Empezar sesión</button>
    </section>
    {plan.feasibility.level === 'insufficient_time' && <p role="alert" data-testid="risk">{plan.feasibility.riskMessage} Recomendamos {plan.feasibility.recommendedAdditionalMinutes} minutos adicionales.</p>}
    <p data-testid="metrics">Cobertura {readiness.coveragePercent}% · Dominio {readiness.masteryPercent}% · Preparación {readiness.examReadinessPercent}%</p>
    <p data-testid="exam-date">Examen: {new Date(plan.examContext.examAt).toLocaleDateString()}</p>
    <ol data-testid="schedule">{plan.sessions.map(s => <li key={s.sessionId} data-status={s.status}>{new Date(s.plannedDate).toLocaleDateString()} · {s.purpose} · {s.plannedDuration} min · {s.reason}</li>)}</ol>
    {plan.revisions.at(-1) && <p data-testid="revision-reason">{plan.revisions.at(-1)?.explanation}</p>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button onClick={() => revise('fast')}>Dominé más rápido</button><button onClick={() => revise('repair')}>Necesité repair</button><button onClick={() => revise('missed')}>Falté a una sesión</button><button onClick={() => revise('date')}>Cambiar fecha</button><button onClick={() => setPaused(v => !v)}>{paused ? 'Reanudar' : 'Pausar'}</button><button onClick={() => { setStudied(plan.requiredMicroIds); setMastered(plan.requiredMicroIds) }}>Simular dominio contractual</button><button onClick={() => setStudied(plan.requiredMicroIds)}>Simular cobertura</button></div>
  </main>
}
