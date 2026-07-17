import assert from 'node:assert/strict'
import { buildInitialStudyPlan } from '../../lib/adaptive/planner/initialPlanner'
import { selectNextActivity } from '../../lib/adaptive/activitySelection/selectNextActivity'
import { reviseStudyPlan } from '../../lib/adaptive/planRevision/reviseStudyPlan'
import { calculateExamReadiness } from '../../lib/adaptive/readiness/calculateReadiness'
import type { PlannerSetup } from '../../lib/adaptive/planner/types'

const now = new Date('2026-07-16T12:00:00.000Z')
const micros = Array.from({ length: 12 }, (_, index) => ({
  id: `m${index + 1}`,
  difficulty: index < 3 ? 0.9 : 0.45,
  importance: index < 3 ? 'critical' as const : 'medium' as const,
  cognitiveType: index % 3 === 0 ? 'procedural' : 'conceptual',
}))

function setup(days: number, overrides: Partial<PlannerSetup> = {}): PlannerSetup {
  return {
    initialLevel: 'zero', sessionLength: 'medium', examAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
    targetScore: 90, assessmentMode: 'mix_everything', examFormat: 'mixed',
    availability: { dailyMinutes: 45, availableDays: [0, 1, 2, 3, 4, 5, 6] }, priorities: [], ...overrides,
  }
}

const tomorrow = buildInitialStudyPlan({ materialId: 'mat', micros, setup: setup(1), now })
const week = buildInitialStudyPlan({ materialId: 'mat', micros, setup: setup(7), now })
const month = buildInitialStudyPlan({ materialId: 'mat', micros, setup: setup(30), now })
assert.ok(tomorrow.sessions.length < week.sessions.length, 'mañana debe comprimir sesiones')
assert.ok(tomorrow.sessions.reduce((n, s) => n + s.assignedMicroIds.length, 0) / tomorrow.sessions.length > week.sessions.reduce((n, s) => n + s.assignedMicroIds.length, 0) / week.sessions.length, 'mañana debe aumentar densidad')
assert.deepEqual(new Set(tomorrow.requiredMicroIds), new Set(micros.map(m => m.id)), 'mañana no pierde micros')
assert.ok(week.sessions.some(s => s.purpose === 'review'), 'una semana usa spacing')
assert.ok(month.sessions.some(s => s.reviewOf.length > 0 && s.plannedDate > month.sessions[0].plannedDate), 'un mes usa delayed recall')
assert.ok(tomorrow.sessions.every(s => s.plannedDate <= tomorrow.examContext.examAt), 'no crea sesiones después del examen')
assert.ok(tomorrow.sessions.some(s => s.status === 'final_exam'), 'mantiene simulación final')
assert.ok(tomorrow.sessions.every(s => !/^Sesión \d+$|Trabajar los conceptos asignados|Simular el formato real del examen/.test(`${s.title}|${s.objective}`)), 'títulos y objetivos visibles no son genéricos')
assert.equal(tomorrow.planningTime.plannedMinutesPerDay, 45, 'disponibilidad se conserva como preferencia')
assert.ok(tomorrow.sessions.every(s => s.plannedDuration > 0), 'dailyMinutes no bloquea ni elimina sesiones')
const prerequisitePlan = buildInitialStudyPlan({ materialId: 'deps', now, setup: setup(1), micros: [
  { id: 'advanced', name: 'Interpretación avanzada', difficulty: .95, importance: 'critical', cognitiveType: 'conceptual', prerequisiteIds: ['foundation'] },
  { id: 'foundation', name: 'Fundamentos', difficulty: .2, importance: 'medium', cognitiveType: 'conceptual' },
] })
assert.deepEqual(prerequisitePlan.sessions[0].assignedMicroIds.slice(0, 2), ['foundation', 'advanced'], 'nivel zero respeta prerequisitos antes de importancia')
const highScore = buildInitialStudyPlan({ materialId: 'mat', micros, setup: setup(7, { targetScore: 100 }), now })
assert.ok(highScore.sessions[0].plannedDuration > week.sessions[0].plannedDuration, 'nota alta aumenta profundidad sin reducir contratos')
const practicePlan = buildInitialStudyPlan({ materialId: 'mat', micros, setup: setup(7, { initialLevel: 'practice' }), now })
assert.equal(practicePlan.sessions[0].purpose, 'retrieve', 'nivel inicial cambia enseñanza')
const priorityPlan = buildInitialStudyPlan({ materialId: 'mat', micros, setup: setup(7, { priorities: ['m9'] }), now })
assert.ok(priorityPlan.sessions[0].assignedMicroIds.includes('m9'), 'prioridad adelanta el micro sin eliminar otros')

const impossible = buildInitialStudyPlan({ materialId: 'long', micros: Array.from({ length: 80 }, (_, i) => ({ ...micros[i % micros.length], id: `x${i}` })), setup: setup(1, { availability: { dailyMinutes: 20, availableDays: [4] } }), now })
assert.equal(impossible.feasibility.level, 'insufficient_time')
assert.equal(impossible.requiredMicroIds.length, 80)

const rapid = selectNextActivity({ assessmentMode: 'quick_test', examFormat: 'multiple_choice', objective: 'transfer', cognitiveType: 'procedural', missingEvidence: ['applied'], recentFormats: [], recentTemplates: [], recentPrompts: [], recentFactKeys: [], priorTeaching: true, lastOutcome: 'correct', confidence: 'high', assistanceLevel: 'independent', examProximityDays: 1, timeBudgetMinutes: 3 })
const writing = selectNextActivity({ ...rapid.input, assessmentMode: 'write_explain', examFormat: 'development' })
assert.ok(!['open_response', 'step_by_step_solver'].includes(rapid.format), 'rapid evita escritura larga')
assert.equal(rapid.objective, 'transfer')
assert.ok(['open_response', 'explain_why', 'practical_case', 'prediction', 'teach_back'].includes(writing.format), 'writing prioriza escritura')
assert.equal(rapid.template, writing.template, 'la intención de template sobrevive al modo visual')
assert.notEqual(rapid.format, writing.format, 'template y formato son capas separadas')
const illusion = selectNextActivity({ ...rapid.input, objective: 'retrieve', priorTeaching: true, lastOutcome: 'incorrect', confidence: 'high' })
assert.equal(illusion.objective, 'repair')
assert.ok(illusion.reasonCodes.includes('ILLUSION_OF_KNOWLEDGE'))
const lowConfidenceCorrect = selectNextActivity({ ...rapid.input, objective: 'apply', priorTeaching: true, lastOutcome: 'correct', confidence: 'low' })
assert.equal(lowConfidenceCorrect.objective, 'retrieve', 'correcta con baja confianza verifica sin repair')
const assisted = selectNextActivity({ ...rapid.input, objective: 'transfer', priorTeaching: true, lastOutcome: 'correct', assistanceLevel: 'revealed' })
assert.equal(assisted.objective, 'retrieve', 'ayuda fuerte exige independencia posterior')
const untaught = selectNextActivity({ ...rapid.input, objective: 'apply', priorTeaching: false, lastOutcome: 'pending' })
assert.equal(untaught.objective, 'recognize', 'no evalúa aplicación no enseñada salvo diagnóstico')
const templateChanged = selectNextActivity({ ...rapid.input, recentTemplates: [rapid.template] })
assert.notEqual(templateChanged.template, rapid.template, 'no repite template cuando existe alternativa')

const revised = reviseStudyPlan(tomorrow, { now, completedSessionId: tomorrow.sessions[0].sessionId, masteredMicroIds: ['m1', 'm2'], unresolvedMicroIds: ['m3'], actualMinutes: 8, confidenceAverage: 80, assistanceRate: 0, missedSessionIds: [] })
assert.equal(revised.sessions.find(s => s.sessionId === tomorrow.sessions[0].sessionId)?.status, 'completed')
assert.ok(revised.sessions.some(s => s.status === 'repair' && s.assignedMicroIds.includes('m3')), 'dificultad inserta repair')
assert.deepEqual(new Set(revised.requiredMicroIds), new Set(tomorrow.requiredMicroIds), 'revision no pierde micros')
assert.ok(revised.revisions.length > tomorrow.revisions.length)
assert.ok(revised.sessions.filter(s => s.status !== 'completed').every(s => s.plannedDuration <= tomorrow.sessions.find(old => old.sessionId === s.sessionId)?.plannedDuration! || s.status === 'repair'), 'ritmo rápido acorta pendientes')
const moved = reviseStudyPlan(week, { now, masteredMicroIds: [], unresolvedMicroIds: [], actualMinutes: 22, confidenceAverage: 50, assistanceRate: 0, missedSessionIds: [week.sessions[0].sessionId] })
assert.equal(moved.sessions.find(s => s.sessionId === week.sessions[0].sessionId)?.status, 'rescheduled')
assert.notEqual(moved.sessions.find(s => s.sessionId === week.sessions[0].sessionId)?.plannedDate, week.sessions[0].plannedDate)
const newDate = new Date(now.getTime() + 14 * 86_400_000).toISOString()
const dateChanged = reviseStudyPlan(week, { now, masteredMicroIds: [], unresolvedMicroIds: [], actualMinutes: 22, confidenceAverage: 50, assistanceRate: 0, missedSessionIds: [], newExamAt: newDate })
assert.equal(dateChanged.examContext.examAt, newDate)
assert.ok(dateChanged.sessions.every(s => s.plannedDate <= newDate))
assert.ok(dateChanged.sessions.some(s => s.status === 'final_exam'), 'revisión conserva final exam')

const readiness = calculateExamReadiness({ requiredMicroIds: micros.map(m => m.id), studiedMicroIds: micros.map(m => m.id), masteredMicroIds: ['m1'], transferReadyMicroIds: [], examFormat: 'mixed' })
assert.equal(readiness.coveragePercent, 100)
assert.ok(readiness.masteryPercent < 100)
assert.ok(readiness.examReadinessPercent < 100)
assert.equal(readiness.isProgramComplete, false)

console.log('Adaptive planner contracts: PASS')
