import type { PlannerSetup } from './types'

const examDays: Record<string, number> = { today: 0.25, tomorrow: 1, in_3_days: 3, in_1_week: 7, in_2_weeks: 14, in_1_month: 30, no_exam: 90 }
export function plannerSetupFromLegacy(setup: Record<string, unknown>, now = new Date()): PlannerSetup {
  const rawExam = String(setup.examDateTime || setup.examDate || 'in_2_weeks')
  const examAt = Number.isFinite(new Date(rawExam).getTime()) ? new Date(rawExam) : new Date(now.getTime() + (examDays[rawExam] || 14) * 86_400_000)
  return {
    initialLevel: ['zero', 'some', 'review', 'practice'].includes(String(setup.initialKnowledgeLevel)) ? String(setup.initialKnowledgeLevel) as PlannerSetup['initialLevel'] : 'some',
    sessionLength: ['short', 'medium', 'long'].includes(String(setup.sessionLength)) ? String(setup.sessionLength) as PlannerSetup['sessionLength'] : 'medium',
    examAt: examAt.toISOString(), targetScore: Math.max(1, Math.min(100, Number(setup.targetScore) || 80)),
    assessmentMode: ['quick_test', 'write_explain', 'mix_everything'].includes(String(setup.evalPreference)) ? String(setup.evalPreference) as PlannerSetup['assessmentMode'] : 'mix_everything',
    examFormat: ['multiple_choice', 'development', 'mixed', 'mathematical', 'practical', 'unknown'].includes(String(setup.examFormat)) ? String(setup.examFormat) as PlannerSetup['examFormat'] : 'unknown',
    availability: typeof setup.availability === 'object' && setup.availability ? setup.availability as PlannerSetup['availability'] : { dailyMinutes: Number(setup.dailyMinutes) || 45, availableDays: [0, 1, 2, 3, 4, 5, 6] },
    priorities: Array.isArray(setup.priorities) ? setup.priorities.map(String) : [],
  }
}
