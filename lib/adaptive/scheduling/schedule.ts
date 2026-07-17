import type { PlannerSetup } from '../planner/types'

export function resolveExamAt(value: string): Date { return new Date(value) }
export function daysUntil(now: Date, exam: Date): number { return Math.max(0, Math.ceil((exam.getTime() - now.getTime()) / 86_400_000)) }
export function availableDates(now: Date, exam: Date, setup: PlannerSetup): Date[] {
  const dates: Date[] = []
  const cursor = new Date(now)
  cursor.setUTCHours(12, 0, 0, 0)
  while (cursor.getTime() < exam.getTime()) {
    if (setup.availability.availableDays.includes(cursor.getUTCDay())) {
      const slots = (setup.availability.timeSlots || []).filter(slot => slot.day === cursor.getUTCDay())
      if (setup.availability.timeSlots?.length) {
        for (const slot of slots) {
          const [hours, minutes] = slot.start.split(':').map(Number)
          const scheduled = new Date(cursor)
          scheduled.setUTCHours(hours, minutes, 0, 0)
          if (scheduled >= now && scheduled < exam) dates.push(scheduled)
        }
      } else dates.push(new Date(cursor))
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates.length ? dates : setup.availability.timeSlots?.length ? [] : [new Date(Math.min(now.getTime(), exam.getTime()))]
}
