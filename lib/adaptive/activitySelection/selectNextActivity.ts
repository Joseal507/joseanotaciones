import { formatsFor } from '../assessmentPreferences/formatPolicy'
import type { AssessmentMode, ExamFormat } from '../planner/types'
import { pickTemplate } from '../templates/catalog'
import { normalizePedagogicalObjective } from './objectives'

export interface ActivitySelectionInput {
  assessmentMode: AssessmentMode; examFormat: ExamFormat; objective: string; cognitiveType: string; missingEvidence: string[]
  recentFormats: string[]; recentTemplates: string[]; recentPrompts: string[]; recentFactKeys: string[]; priorTeaching: boolean
  lastOutcome: string; confidence: string; assistanceLevel: string; examProximityDays: number; timeBudgetMinutes: number
}
export interface ActivityDecision { input: ActivitySelectionInput; objective: string; format: string; template: string; strategy: string; reasonCodes: string[]; repetitionIntent: null | string }

export function selectNextActivity(input: ActivitySelectionInput): ActivityDecision {
  let objective: string = normalizePedagogicalObjective(input.objective)
  const reasons = [`OBJECTIVE_${objective.toUpperCase()}`, `MODE_${input.assessmentMode.toUpperCase()}`]
  if (!input.priorTeaching && !['diagnose', 'recognize'].includes(objective)) { objective = 'recognize'; reasons.push('FOUNDATION_BEFORE_UNTAUGHT_ASSESSMENT') }
  else if (input.lastOutcome === 'incorrect' && input.confidence === 'high') { objective = 'repair'; reasons.push('ILLUSION_OF_KNOWLEDGE') }
  else if (input.lastOutcome === 'correct' && input.confidence === 'low') { objective = 'retrieve'; reasons.push('LOW_CONFIDENCE_VERIFICATION') }
  else if (input.assistanceLevel !== 'independent') { objective = 'retrieve'; reasons.push('INDEPENDENCE_REQUIRED') }
  else if (input.lastOutcome === 'correct' && objective === 'recognize') { objective = input.missingEvidence.includes('applied') ? 'apply' : 'retrieve'; reasons.push('ADVANCE_EVIDENCE_AFTER_SUCCESS') }
  const candidates = formatsFor(input.assessmentMode, objective, input.examFormat)
  const format = candidates.find(candidate => !input.recentFormats.slice(-2).includes(candidate)) || candidates[0]
  const template = pickTemplate(objective, input.recentTemplates)
  return { input, objective, format, template, strategy: objective === 'repair' ? 'contrast_then_new_representation' : `${objective}_${input.cognitiveType}`, reasonCodes: reasons, repetitionIntent: null }
}
