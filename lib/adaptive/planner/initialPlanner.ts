import { calculateFeasibility } from '../feasibility/calculateFeasibility'
import { availableDates, daysUntil, resolveExamAt } from '../scheduling/schedule'
import type { PlanPurpose, PlanSession, PlannerMicro, PlannerSetup, StudyPlan } from './types'

const duration = { short: 12, medium: 22, long: 35 }
const groups = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))

const capability = (purpose: PlanPurpose, names: string[]) => {
  const topic = names.length <= 2 ? names.join(' y ') : `${names.slice(0, 2).join(' y ')} y sus conexiones`
  if (purpose === 'exam') return `Integrar y transferir lo aprendido de ${topic}`
  if (purpose === 'review') return `Recuperar y relacionar ${topic} sin apoyo`
  if (purpose === 'apply') return `Aplicar y explicar ${topic} en situaciones nuevas`
  if (purpose === 'integrate') return `Relacionar e integrar ${topic} en una visión completa`
  if (purpose === 'repair') return `Distinguir y corregir las dificultades de ${topic}`
  if (purpose === 'retrieve') return `Recordar y explicar ${topic} con precisión`
  return `Comprender y distinguir ${topic}`
}

const sessionTitle = (purpose: PlanPurpose, names: string[]) => {
  const topic = names.length <= 2 ? names.join(' y ') : `${names[0]}: fundamentos y conexiones`
  if (purpose === 'exam') return `Simulación integral: ${names[0] || 'material completo'}`
  if (purpose === 'review') return `Recuperación de ${topic}`
  if (purpose === 'repair') return `Refuerzo de ${topic}`
  return topic || 'Fundamentos del material'
}

function orderMicros(micros: PlannerMicro[], priorities: string[], initialLevel: PlannerSetup['initialLevel']): PlannerMicro[] {
  const byId = new Map(micros.map(micro => [micro.id, micro]))
  const priority = new Set(priorities.map(value => value.toLocaleLowerCase()))
  const remaining = new Set(micros.map(micro => micro.id))
  const result: PlannerMicro[] = []
  while (remaining.size) {
    const ready = [...remaining].map(id => byId.get(id)!).filter(micro => (micro.prerequisiteIds || []).every(id => !remaining.has(id)))
    const candidates = ready.length ? ready : [...remaining].map(id => byId.get(id)!)
    candidates.sort((a, b) => Number(priority.has(b.id.toLocaleLowerCase())) - Number(priority.has(a.id.toLocaleLowerCase()))
      || (initialLevel === 'zero' ? a.difficulty - b.difficulty : b.difficulty - a.difficulty)
      || Number(b.importance === 'critical') - Number(a.importance === 'critical') || a.id.localeCompare(b.id))
    const next = candidates[0]
    result.push(next)
    remaining.delete(next.id)
  }
  return result
}

export function buildInitialStudyPlan(input: { materialId: string; micros: PlannerMicro[]; setup: PlannerSetup; now?: Date }): StudyPlan {
  const now = input.now || new Date()
  const exam = resolveExamAt(input.setup.examAt)
  const days = daysUntil(now, exam)
  const feasibility = calculateFeasibility(input.micros, input.setup, days)
  const dates = availableDates(now, exam, input.setup)
  const density = days <= 1 ? 4 : days <= 3 ? 3 : input.setup.sessionLength === 'short' ? 2 : input.setup.sessionLength === 'long' ? 5 : 3
  const ordered = orderMicros(input.micros, input.setup.priorities, input.setup.initialLevel)
  const byId = new Map(ordered.map(micro => [micro.id, micro]))
  const learningGroups = groups(ordered, density)
  const sessions: PlanSession[] = []
  const make = (ids: string[], purpose: PlanPurpose, dateIndex: number, status: PlanSession['status'], reason: string, reviewOf: string[] = []): PlanSession => ({
    sessionId: `plan_${purpose}_${sessions.length + 1}`, materialId: input.materialId, assignedMicroIds: ids, purpose,
    title: sessionTitle(purpose, ids.map(id => byId.get(id)?.name || id)),
    objective: capability(purpose, ids.map(id => byId.get(id)?.name || id)),
    plannedDate: (dates[Math.min(dateIndex, dates.length - 1)] || now).toISOString(), plannedDuration: Math.round(duration[input.setup.sessionLength] * (input.setup.targetScore >= 95 ? 1.12 : 1)),
    estimatedDifficulty: ids.length ? ordered.filter(m => ids.includes(m.id)).reduce((n, m) => n + m.difficulty, 0) / ids.length : 0.6,
    assessmentMode: input.setup.assessmentMode, examAlignment: input.setup.examFormat, reason, status, repairOf: null, reviewOf, prerequisites: [], revisionVersion: 1,
  })
  learningGroups.forEach((group, index) => sessions.push(make(group.map(m => m.id), index === learningGroups.length - 1 ? 'apply' : input.setup.initialLevel === 'practice' ? 'retrieve' : 'learn', Math.floor(index * dates.length / Math.max(1, learningGroups.length)), index === 0 ? 'available' : 'planned', days <= 1 ? 'Cobertura comprimida por examen próximo' : input.setup.initialLevel === 'practice' ? 'Recuperación activa porque indicaste dominio previo' : 'Secuencia gradual según dificultad y prioridad')))
  if (days >= 5) sessions.push(make(ordered.slice(0, Math.min(6, ordered.length)).map(m => m.id), 'review', Math.max(1, dates.length - 2), 'review', days >= 21 ? 'Repaso diferido para reducir riesgo de olvido' : 'Repaso espaciado', sessions.slice(0, 2).map(s => s.sessionId)))
  if (days >= 21) sessions.push(make(ordered.slice(0, Math.min(8, ordered.length)).map(m => m.id), 'integrate', Math.floor(dates.length * .65), 'planned', 'Integración y transferencia antes del examen'))
  sessions.push(make(ordered.map(m => m.id), 'exam', Math.max(0, dates.length - 1), 'final_exam', `Simulación alineada a ${input.setup.examFormat}`))
  sessions.sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || Number(a.status === 'final_exam') - Number(b.status === 'final_exam'))
  const timestamp = now.toISOString()
  return { source: 'canonical_study_plan_v1', planId: `study_plan_${input.materialId}_${now.getTime()}`, materialId: input.materialId, setup: input.setup, requiredMicroIds: input.micros.map(m => m.id), sessions, examContext: { examAt: exam.toISOString(), daysRemaining: days, format: input.setup.examFormat }, feasibility, revisions: [], revisionVersion: 1, createdAt: timestamp, updatedAt: timestamp, planningTime: { plannedMinutesPerDay: input.setup.availability.dailyMinutes, estimatedTotalMinutes: feasibility.estimatedMinutes, actualStudyMinutes: 0, optionalSessionTarget: input.setup.availability.dailyMinutes } }
}
