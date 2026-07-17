import type { PlanSession, StudyPlan } from '../planner/types'
import { availableDates } from '../scheduling/schedule'

export interface RevisionEvidence { now: Date; completedSessionId?: string; masteredMicroIds: string[]; unresolvedMicroIds: string[]; actualMinutes: number; confidenceAverage: number; assistanceRate: number; missedSessionIds: string[]; newExamAt?: string }
export function reviseStudyPlan(plan: StudyPlan, evidence: RevisionEvidence): StudyPlan {
  const version = plan.revisionVersion + 1
  const reasons: string[] = []
  const completedPlanned = plan.sessions.find(s => s.sessionId === evidence.completedSessionId)
  const fastPace = evidence.actualMinutes > 0 && evidence.actualMinutes < (completedPlanned?.plannedDuration || Infinity) * .65
  let sessions = plan.sessions.map(session => {
    if (session.sessionId === evidence.completedSessionId) return { ...session, status: 'completed' as const }
    if (evidence.missedSessionIds.includes(session.sessionId) && session.status !== 'completed') { reasons.push('MISSED_SESSION_RESCHEDULED'); return { ...session, status: 'rescheduled' as const, plannedDate: new Date(Math.min(new Date(plan.examContext.examAt).getTime(), new Date(session.plannedDate).getTime() + 86_400_000)).toISOString(), revisionVersion: version } }
    return fastPace && session.status !== 'completed' ? { ...session, plannedDuration: Math.max(8, Math.round(session.plannedDuration * .85)), revisionVersion: version } : session
  })
  const added: PlanSession[] = []
  if (evidence.unresolvedMicroIds.length) {
    reasons.push('UNRESOLVED_REPAIR_INSERTED')
    const anchor = sessions.find(s => s.sessionId === evidence.completedSessionId) || sessions[0]
    added.push({ ...anchor, sessionId: `repair_v${version}_${plan.revisions.length + 1}`, assignedMicroIds: [...evidence.unresolvedMicroIds], purpose: 'repair', title: `Refuerzo: ${anchor.title}`, objective: 'Distinguir, explicar y corregir las dificultades detectadas', reason: 'La evidencia de la sesión dejó conceptos por resolver', status: 'repair', repairOf: evidence.completedSessionId || null, reviewOf: [], revisionVersion: version, plannedDate: evidence.now.toISOString() })
  }
  if (fastPace) reasons.push('PACE_FASTER_THAN_PLANNED')
  const examAt = evidence.newExamAt || plan.examContext.examAt
  const revisedSetup = { ...plan.setup, examAt }
  const missedThreshold = evidence.missedSessionIds
    .map(id => plan.sessions.find(session => session.sessionId === id)?.plannedDate)
    .filter((value): value is string => Boolean(value)).sort().at(-1)
  const validDates = availableDates(evidence.now, new Date(examAt), revisedSetup)
    .filter(date => !missedThreshold || date.toISOString() > missedThreshold)
  const revisionCalendar = Boolean(evidence.newExamAt) || evidence.missedSessionIds.length > 0
  sessions = [...sessions.filter(s => s.status === 'completed'), ...added, ...sessions.filter(s => s.status !== 'completed')]
  const pendingCount = sessions.filter(s => s.status !== 'completed').length
  let pendingIndex = 0
  sessions = sessions.map(session => {
    if (session.status === 'completed') return session
    const mustReschedule = revisionCalendar
    const redistributed = mustReschedule && validDates.length
      ? validDates[Math.min(pendingIndex++, validDates.length - 1)].toISOString()
      : session.plannedDate
    return { ...session, status: mustReschedule && !validDates.length ? 'valid_incomplete' : session.status, plannedDate: redistributed > examAt ? examAt : redistributed, revisionVersion: version }
  })
  const revision = { version, createdAt: evidence.now.toISOString(), reasonCodes: [...new Set(reasons)], explanation: reasons.includes('UNRESOLVED_REPAIR_INSERTED') ? 'Añadimos una sesión de reparación porque quedaron conceptos por resolver.' : 'Ajustamos el calendario según tu ritmo real.', addedSessionIds: added.map(s => s.sessionId), removedSessionIds: [], rescheduledSessionIds: evidence.missedSessionIds }
  return { ...plan, setup: revisedSetup, sessions, examContext: { ...plan.examContext, examAt }, planningTime: { ...plan.planningTime, actualStudyMinutes: plan.planningTime.actualStudyMinutes + Math.max(0, evidence.actualMinutes) }, revisionVersion: version, revisions: [...plan.revisions, revision], updatedAt: evidence.now.toISOString() }
}
