import type { AdaptiveSession, SessionPurpose } from '../program'
import type { PlanSession, StudyPlan } from './types'

const purposes: Record<PlanSession['purpose'], SessionPurpose> = { learn: 'understand', retrieve: 'memorize', apply: 'apply', integrate: 'organize', repair: 'repair', review: 'memorize', exam: 'simulate' }
export function adaptStudyPlanToSessions(plan: StudyPlan, existing: AdaptiveSession[] = []): AdaptiveSession[] {
  const byId = new Map(existing.map(session => [session.id, session]))
  const activeId = existing.find(session => session.status === 'in_progress')?.id
  const projected = plan.sessions.map((planned, index): AdaptiveSession => {
    const prior = byId.get(planned.sessionId)
    const retention = planned.purpose === 'review' || planned.purpose === 'exam'
    const base: AdaptiveSession = {
      id: planned.sessionId, sessionNumber: index + 1,
      title: planned.title,
      objective: planned.objective, estimatedMinutes: planned.plannedDuration, status: 'locked', purpose: purposes[planned.purpose], steps: [], expectedDomainGain: 15,
      topicId: `planned_topic_${index + 1}`, topicTitle: planned.objective, targetConcepts: prior?.targetConcepts || [], sourcePages: prior?.sourcePages || [], evidenceGoal: planned.examAlignment,
      evaluationPreference: planned.assessmentMode, examFormat: plan.setup.examFormat, sessionFormat: planned.purpose === 'exam' ? 'exam_simulation' : planned.purpose === 'repair' ? 'repair_dialogue' : planned.purpose === 'review' ? 'rapid_review' : 'discovery',
      planRationale: planned.reason, plannedDate: planned.plannedDate, planStatus: planned.status, planReason: planned.reason, repairOf: planned.repairOf, reviewOf: planned.reviewOf, revisionVersion: planned.revisionVersion,
      assignedMicroIds: [...planned.assignedMicroIds], requiredMicroIds: retention ? [] : [...planned.assignedMicroIds], retentionMicroIds: retention ? [...planned.assignedMicroIds] : [],
    }
    return prior ? { ...base, ...prior, sessionNumber: index + 1, plannedDate: planned.plannedDate, planStatus: planned.status, planReason: planned.reason, repairOf: planned.repairOf, reviewOf: planned.reviewOf, revisionVersion: planned.revisionVersion, assignedMicroIds: [...planned.assignedMicroIds], requiredMicroIds: retention ? [] : [...planned.assignedMicroIds], retentionMicroIds: retention ? [...planned.assignedMicroIds] : [] } : base
  })
  if (activeId && projected.some(session => session.id === activeId)) return projected.map(session => session.id === activeId ? { ...session, status: 'in_progress' } : session.status === 'completed' ? session : { ...session, status: 'locked' })
  let unlocked = false
  return projected.map(session => {
    if (session.status === 'completed') return session
    if (!unlocked) { unlocked = true; return { ...session, status: 'available' } }
    return { ...session, status: 'locked' }
  })
}
