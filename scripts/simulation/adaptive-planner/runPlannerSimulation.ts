import assert from 'node:assert/strict'
import { buildInitialStudyPlan } from '../../../lib/adaptive/planner/initialPlanner'
import { reviseStudyPlan } from '../../../lib/adaptive/planRevision/reviseStudyPlan'
import { calculateExamReadiness } from '../../../lib/adaptive/readiness/calculateReadiness'

const profiles = [
  ['capable', 1, 0, false], ['misconception_prone', .55, .2, false], ['low_confidence', .8, 0, false],
  ['assistance_dependent', .35, .65, false], ['random_guesser', .15, 0, false], ['inconsistent', .5, .1, false],
  ['missed_sessions', .55, .1, true], ['fast_mastery', 1, 0, false], ['slow_mastery', .4, .2, false],
] as const
const now = new Date('2026-07-16T12:00:00Z')
const micros = Array.from({ length: 18 }, (_, i) => ({ id: `m${i}`, difficulty: .4 + (i % 4) * .15, importance: i < 4 ? 'critical' as const : 'medium' as const, cognitiveType: i % 3 ? 'conceptual' : 'procedural' }))
for (const [name, masteryRate, assistanceRate, misses] of profiles) {
  let plan = buildInitialStudyPlan({ materialId: 'simulation', micros, now, setup: { initialLevel: name === 'fast_mastery' ? 'practice' : 'some', sessionLength: 'medium', examAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(), targetScore: 90, assessmentMode: 'mix_everything', examFormat: 'mixed', availability: { dailyMinutes: 45, availableDays: [0,1,2,3,4,5,6] }, priorities: [] } })
  const mastered = micros.slice(0, Math.floor(micros.length * masteryRate)).map(m => m.id)
  const unresolved = micros.map(m => m.id).filter(id => !mastered.includes(id))
  plan = reviseStudyPlan(plan, { now, completedSessionId: plan.sessions[0].sessionId, masteredMicroIds: mastered, unresolvedMicroIds: unresolved, actualMinutes: name === 'fast_mastery' ? 6 : 22, confidenceAverage: name === 'low_confidence' ? 30 : 70, assistanceRate, missedSessionIds: misses ? [plan.sessions[1].sessionId] : [] })
  const readiness = calculateExamReadiness({ requiredMicroIds: plan.requiredMicroIds, studiedMicroIds: micros.map(m => m.id), masteredMicroIds: mastered, transferReadyMicroIds: mastered.slice(0, Math.floor(mastered.length * .7)), examFormat: 'mixed' })
  const metrics = { profile: name, planCompletion: plan.sessions.filter(s => s.status === 'completed').length / plan.sessions.length, scheduleAdherence: misses ? 0 : 1, sessionsAdded: plan.revisions.at(-1)?.addedSessionIds.length || 0, reschedules: plan.revisions.at(-1)?.rescheduledSessionIds.length || 0, repairs: plan.sessions.filter(s => s.status === 'repair').length, coverage: readiness.coveragePercent, mastery: readiness.masteryPercent, readiness: readiness.examReadinessPercent, falseMastery: readiness.isProgramComplete && unresolved.length > 0 ? 1 : 0, deadlineViolations: plan.sessions.filter(s => s.plannedDate > plan.examContext.examAt).length, microsLost: micros.filter(m => !plan.requiredMicroIds.includes(m.id)).length, userBurdenMinutes: plan.sessions.reduce((n,s) => n+s.plannedDuration,0) }
  assert.equal(metrics.falseMastery, 0)
  assert.equal(metrics.deadlineViolations, 0)
  assert.equal(metrics.microsLost, 0)
  console.log(JSON.stringify(metrics))
}
console.log('Adaptive planner simulation: PASS 9/9')
