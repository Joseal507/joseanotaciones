import assert from 'node:assert/strict'
import { buildInitialStudyPlan } from '../../lib/adaptive/planner/initialPlanner'
import { adaptStudyPlanToSessions } from '../../lib/adaptive/planner/adaptStudyPlanToSessions'
import { reviseStudyPlan } from '../../lib/adaptive/planRevision/reviseStudyPlan'
import { isCanonicalStudyPlan } from '../../lib/adaptive/planner/canonicalPlan'
import { hasRealPriorTeaching } from '../../lib/adaptive/activitySelection/priorTeaching'

const now = new Date('2026-07-16T12:00:00Z')
const micros = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, difficulty: .5, importance: i < 2 ? 'critical' as const : 'medium' as const, cognitiveType: 'conceptual' }))
const plan = buildInitialStudyPlan({ materialId: 'mat', micros, now, setup: { initialLevel: 'zero', sessionLength: 'medium', examAt: new Date(now.getTime()+7*86_400_000).toISOString(), targetScore: 90, assessmentMode: 'mix_everything', examFormat: 'mixed', availability: { dailyMinutes: 45, availableDays: [0,1,2,3,4,5,6] }, priorities: [] } })
const initial = adaptStudyPlanToSessions(plan, [])
assert.equal(initial.length, plan.sessions.length)
assert.deepEqual(new Set(initial.flatMap(s => [...(s.requiredMicroIds || []), ...(s.retentionMicroIds || [])])), new Set(plan.requiredMicroIds))
assert.equal(new Set(initial.map(s => s.id)).size, initial.length)
const completed = { ...initial[0], status: 'completed' as const, completedAt: 123, conceptsImproved: ['real'] }
const active = { ...initial[1], status: 'in_progress' as const }
const restored = adaptStudyPlanToSessions(plan, [completed, active])
assert.equal(restored[0].status, 'completed')
assert.equal(restored[0].completedAt, 123)
assert.deepEqual(restored[0].conceptsImproved, ['real'])
assert.equal(restored[1].status, 'in_progress')
const revised = reviseStudyPlan(plan, { now, completedSessionId: plan.sessions[0].sessionId, masteredMicroIds: ['m0'], unresolvedMicroIds: ['m1'], actualMinutes: 12, confidenceAverage: 60, assistanceRate: .2, missedSessionIds: [plan.sessions[1].sessionId] })
const synced = adaptStudyPlanToSessions(revised, [completed, active])
assert.equal(synced.length, revised.sessions.length)
assert.ok(synced.some(s => s.purpose === 'repair' && s.assignedMicroIds?.includes('m1')))
assert.equal(synced.find(s => s.id === completed.id)?.status, 'completed')
assert.ok(synced.every(s => !s.plannedDate || s.plannedDate <= revised.examContext.examAt))
assert.equal(isCanonicalStudyPlan(plan), true)
assert.equal(isCanonicalStudyPlan({ ...plan, source: 'legacy' }), false)
assert.equal(hasRealPriorTeaching([], 'm0'), false)
assert.equal(hasRealPriorTeaching([{ microId: 'm0', content: { type: 'teaching', summary: 'Explicación real' } }], 'm0'), true)
assert.equal(hasRealPriorTeaching([{ microId: 'm0', content: { type: 'interaction', summary: 'Descripción corta' } }], 'm0'), false)

const slotsPlan = buildInitialStudyPlan({ materialId: 'slots', micros, now, setup: { ...plan.setup, availability: { dailyMinutes: 60, availableDays: [4,5], timeSlots: [{ day: 4, start: '18:00', minutes: 30 }, { day: 5, start: '09:00', minutes: 30 }] } } })
assert.ok(slotsPlan.sessions.every(s => ['18:00','09:00'].some(time => s.plannedDate.includes(`T${time}`))))
console.log('Adaptive product integration contracts: PASS')
