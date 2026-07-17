import type { ExamFormat } from '../planner/types'

export function calculateExamReadiness(input: { requiredMicroIds: string[]; studiedMicroIds: string[]; masteredMicroIds: string[]; transferReadyMicroIds: string[]; examFormat: ExamFormat }) {
  const total = Math.max(1, input.requiredMicroIds.length)
  const required = new Set(input.requiredMicroIds)
  const count = (values: string[]) => new Set(values.filter(id => required.has(id))).size
  const coveragePercent = Math.round(count(input.studiedMicroIds) / total * 100)
  const masteryPercent = Math.round(count(input.masteredMicroIds) / total * 100)
  const transferPercent = Math.round(count(input.transferReadyMicroIds) / total * 100)
  const formatWeight = ['development', 'mathematical', 'practical'].includes(input.examFormat) ? .45 : .25
  const examReadinessPercent = Math.round(masteryPercent * (1 - formatWeight) + transferPercent * formatWeight)
  const unresolvedMicroIds = input.requiredMicroIds.filter(id => !input.masteredMicroIds.includes(id))
  return { coveragePercent, masteryPercent, examReadinessPercent, unresolvedMicroIds, isProgramComplete: masteryPercent === 100 && unresolvedMicroIds.length === 0 }
}
