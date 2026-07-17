import type { Feasibility, PlannerMicro, PlannerSetup } from '../planner/types'

export function calculateFeasibility(micros: PlannerMicro[], setup: PlannerSetup, days: number): Feasibility {
  const levelFactor = { zero: 1.25, some: 1, review: 0.72, practice: 0.55 }[setup.initialLevel]
  const scoreFactor = setup.targetScore >= 95 ? 1.25 : setup.targetScore >= 85 ? 1.1 : 0.95
  const formatFactor = ['development', 'mathematical', 'practical'].includes(setup.examFormat) ? 1.12 : 1
  const estimatedMinutes = Math.ceil(micros.reduce((sum, micro) => sum + 7 + micro.difficulty * 9 + (micro.importance === 'critical' ? 5 : 0), 0) * levelFactor * scoreFactor * formatFactor)
  const usableDays = Math.max(1, days)
  const scheduledDays = Array.from({ length: usableDays }, (_, i) => i).filter(i => setup.availability.availableDays.includes((new Date(Date.now() + i * 86_400_000)).getUTCDay())).length || 1
  const slotMinutes = setup.availability.timeSlots?.length
    ? setup.availability.timeSlots.reduce((sum, slot) => sum + slot.minutes, 0) * Math.max(1, Math.ceil(usableDays / 7))
    : scheduledDays * setup.availability.dailyMinutes
  const availableMinutes = Math.max(setup.availability.todayMinutes || 0, slotMinutes)
  const ratio = availableMinutes / Math.max(1, estimatedMinutes)
  const level = ratio >= 1.05 ? 'feasible' : ratio >= 0.58 ? 'aggressive' : 'insufficient_time'
  return {
    level, estimatedMinutes, availableMinutes,
    riskMessage: level === 'insufficient_time' ? `No es realista dominar todo en ${availableMinutes} minutos; mantendremos cobertura completa y priorizaremos dominio crítico.` : level === 'aggressive' ? 'El plan es intenso y requerirá repairs inmediatos.' : 'Hay tiempo suficiente para aprendizaje y repaso espaciado.',
    recommendedAdditionalMinutes: Math.max(0, estimatedMinutes - availableMinutes),
  }
}
