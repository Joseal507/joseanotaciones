export type InitialLevel = 'zero' | 'some' | 'review' | 'practice'
export type AssessmentMode = 'quick_test' | 'write_explain' | 'mix_everything'
export type ExamFormat = 'multiple_choice' | 'development' | 'mixed' | 'mathematical' | 'practical' | 'unknown'
export type FeasibilityLevel = 'feasible' | 'aggressive' | 'insufficient_time'
export type PlanSessionStatus = 'planned' | 'available' | 'active' | 'completed' | 'missed' | 'rescheduled' | 'repair' | 'review' | 'final_exam' | 'valid_incomplete'
export type PlanPurpose = 'learn' | 'retrieve' | 'apply' | 'integrate' | 'repair' | 'review' | 'exam'

export interface Availability { dailyMinutes: number; availableDays: number[]; todayMinutes?: number; timeSlots?: Array<{ day: number; start: string; minutes: number }> }
export interface PlannerSetup {
  initialLevel: InitialLevel
  sessionLength: 'short' | 'medium' | 'long'
  examAt: string
  targetScore: number
  assessmentMode: AssessmentMode
  examFormat: ExamFormat
  availability: Availability
  priorities: string[]
}
export interface PlannerMicro {
  id: string
  name?: string
  difficulty: number
  importance: 'low' | 'medium' | 'high' | 'critical'
  cognitiveType: string
  prerequisiteIds?: string[]
}
export interface Feasibility { level: FeasibilityLevel; estimatedMinutes: number; availableMinutes: number; riskMessage: string; recommendedAdditionalMinutes: number }
export interface PlanSession {
  sessionId: string; materialId: string; assignedMicroIds: string[]; purpose: PlanPurpose; title: string; objective: string
  plannedDate: string; plannedDuration: number; estimatedDifficulty: number; assessmentMode: AssessmentMode
  examAlignment: string; reason: string; status: PlanSessionStatus; repairOf: string | null; reviewOf: string[]
  prerequisites: string[]; revisionVersion: number
}
export interface PlanRevision { version: number; createdAt: string; reasonCodes: string[]; explanation: string; addedSessionIds: string[]; removedSessionIds: string[]; rescheduledSessionIds: string[] }
export interface StudyPlan {
  source: 'canonical_study_plan_v1'
  planId: string; materialId: string; setup: PlannerSetup; requiredMicroIds: string[]; sessions: PlanSession[]
  examContext: { examAt: string; daysRemaining: number; format: ExamFormat }; feasibility: Feasibility
  revisions: PlanRevision[]; revisionVersion: number; createdAt: string; updatedAt: string
  planningTime: { plannedMinutesPerDay: number; estimatedTotalMinutes: number; actualStudyMinutes: number; optionalSessionTarget: number }
}
