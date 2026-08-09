import {
  validateGeneratedSessionEvaluation,
  type EvaluationBlock,
  type SessionEvaluationValidation,
  type SessionStep,
} from './evaluation/sessionEvaluation'

export type SessionKind = 'introduction' | 'learning' | 'final_review'

type LegacyChapter = Record<string, unknown> & { kind?: unknown; type?: unknown }
type Telemetry = (event: string, payload: Record<string, unknown>) => void

export function resolveSessionKind(chapter: LegacyChapter): { kind: SessionKind; migrated: boolean } {
  if (chapter.kind === 'introduction' || chapter.kind === 'learning' || chapter.kind === 'final_review') {
    return { kind: chapter.kind, migrated: false }
  }
  // Legacy `type` and arc metadata are persisted structural plan fields, not visible copy.
  if (chapter.type === 'intro' || chapter.arcRole === 'orientation' || chapter.arcId === 'intro') {
    return { kind: 'introduction', migrated: true }
  }
  if (chapter.type === 'final_review' || chapter.arcRole === 'final_review' || chapter.arcId === 'final') {
    return { kind: 'final_review', migrated: true }
  }
  if (chapter.type === 'learning') return { kind: 'learning', migrated: true }
  const blockIds = Array.isArray(chapter.blockIds) ? chapter.blockIds : []
  const unitIds = Array.isArray(chapter.unitIds) ? chapter.unitIds : []
  if (blockIds.length > 0 || unitIds.length > 0) return { kind: 'learning', migrated: true }
  throw new Error(`LEGACY_SESSION_KIND_UNRESOLVED:sessionId=${String(chapter.id || 'unknown')}`)
}

export function migrateJourneySessionKinds<T extends { id?: unknown; chapters?: LegacyChapter[] }>(
  journey: T,
  telemetry?: Telemetry,
  context: { materialId?: string | null } = {},
): { journey: T & { chapters: Array<LegacyChapter & { kind: SessionKind }> }; migrated: boolean } {
  let migrated = false
  const chapters = (journey.chapters || []).map(chapter => {
    const resolved = resolveSessionKind(chapter)
    if (resolved.migrated) {
      migrated = true
      telemetry?.('legacy_session_kind_migrated', {
        sessionId: String(chapter.id || ''), kind: resolved.kind,
        planId: String(journey.id || ''), materialId: context.materialId || null,
      })
    }
    return { ...chapter, kind: resolved.kind }
  })
  return { journey: { ...journey, chapters }, migrated }
}

export const shouldEvaluateSession = (kind: SessionKind): boolean => kind === 'learning'

export function validateSessionEvaluationForKind(
  input: { sessionId: string; kind: SessionKind; steps: SessionStep[]; evaluationBlocks: EvaluationBlock[] },
  evaluationMode: unknown,
): SessionEvaluationValidation {
  const context = `sessionId=${input.sessionId}:kind=${input.kind}`
  if (!shouldEvaluateSession(input.kind)) {
    const forbidden = input.evaluationBlocks.length > 0
    return {
      valid: !forbidden,
      errors: forbidden ? [`SESSION_KIND_CONTRACT:evaluation_forbidden:${context}:blockIds=${input.evaluationBlocks.map(block => block.id).join('|')}`] : [],
      coverageRatio: 1, coveredRequiredStepIds: [], uncoveredRequiredStepIds: [],
      coveredCriticalKeyPoints: [], uncoveredCriticalKeyPoints: [], uncoveredImportantKeyPoints: [], coverageFailures: [],
    }
  }
  if (input.steps.length > 0 && input.evaluationBlocks.length === 0) {
    return {
      valid: false,
      errors: [`SESSION_KIND_CONTRACT:learning_missing_evaluation:${context}:blockId=none:missing=all_evaluable_content`],
      coverageRatio: 0, coveredRequiredStepIds: [],
      uncoveredRequiredStepIds: input.steps.filter(step => step.importance !== 'supporting').map(step => step.id),
      coveredCriticalKeyPoints: [],
      uncoveredCriticalKeyPoints: input.steps.filter(step => step.importance === 'critical').flatMap(step => step.keyPoints),
      uncoveredImportantKeyPoints: input.steps.filter(step => step.importance === 'important').flatMap(step => step.keyPoints),
      coverageFailures: [],
    }
  }
  const result = validateGeneratedSessionEvaluation({ steps: input.steps, evaluationBlocks: input.evaluationBlocks }, evaluationMode, input.kind)
  return { ...result, errors: result.errors.map(error => `${error}:${context}`), valid: result.valid }
}

export function calculateGlobalLearningAssessmentCoverage(sessions: Array<{
  sessionId: string; kind: SessionKind; taughtKeyPoints: string[]; assessedKeyPoints: string[]
}>): { coverageRatio: number; taughtKeyPoints: string[]; assessedKeyPoints: string[]; missingKeyPoints: string[] } {
  const learning = sessions.filter(session => session.kind === 'learning')
  const taught = [...new Set(learning.flatMap(session => session.taughtKeyPoints))]
  const assessedSet = new Set(learning.flatMap(session => session.assessedKeyPoints))
  const assessed = taught.filter(point => assessedSet.has(point))
  return { coverageRatio: taught.length ? assessed.length / taught.length : 1, taughtKeyPoints: taught, assessedKeyPoints: assessed, missingKeyPoints: taught.filter(point => !assessedSet.has(point)) }
}
