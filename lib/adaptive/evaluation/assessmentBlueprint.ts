import type { CognitiveDimension } from '../v3/engine/masteryContract'

export type AssessmentObjectiveStatus =
  | 'not_assessed'
  | 'in_progress'
  | 'demonstrated'
  | 'failed'
  | 'recovery_required'

export interface SourceSpan {
  stepId: string
  factKey: string
  blockId?: string
}

export interface AssessmentObjective {
  objectiveId: string
  sessionId: string
  stepId: string
  microId: string
  factKeys: string[]
  cognitiveTarget: CognitiveDimension
  importance: number
  taught: boolean
  practiced: boolean
  assessed: boolean
  independentlyCorrect: boolean
  assistedCorrect: boolean
  failedAttempts: number
  evidenceIds: string[]
  status: AssessmentObjectiveStatus
  subsumedByObjectiveId?: string
}

export interface AssessmentBlueprint {
  sessionId: string
  version: number
  objectives: AssessmentObjective[]
  taughtObjectiveIds: string[]
  assessedObjectiveIds: string[]
  demonstratedObjectiveIds: string[]
  unresolvedObjectiveIds: string[]
  coverageRatio: number
}

export interface AssessmentStepDeclaration {
  id: string
  type: string
  microId?: string
  factKeys?: string[]
  cognitiveTarget?: CognitiveDimension
  objectiveIds?: string[]
  relatedBlockIds?: string[]
  importance?: number
}

export interface AssessmentQuestionTarget {
  targetObjectiveIds: string[]
  microId: string
  factKeys: string[]
  cognitiveTarget: CognitiveDimension
  questionText?: string
}

export interface AssessmentQuestionPlan {
  plannedQuestions: Array<{
    plannedQuestionId: string
    targetObjectiveIds: string[]
    preferredTypes: string[]
    rationale: string
  }>
  projectedCoverage: number
}

const DIMENSIONS = new Set<CognitiveDimension>(['recognition', 'comprehension', 'application', 'transfer'])

function declaredDimension(step: AssessmentStepDeclaration): CognitiveDimension {
  if (step.cognitiveTarget && DIMENSIONS.has(step.cognitiveTarget)) return step.cognitiveTarget
  if (step.type === 'formula' || step.type === 'example') return 'application'
  if (step.type === 'connection') return 'transfer'
  if (step.type === 'concept' || step.type === 'warning') return 'comprehension'
  return 'recognition'
}

function refreshBlueprint(sessionId: string, version: number, objectives: AssessmentObjective[]): AssessmentBlueprint {
  const taught = objectives.filter(objective => objective.taught)
  const assessed = taught.filter(objective => objective.assessed)
  const demonstrated = taught.filter(objective => objective.independentlyCorrect)
  const unresolved = taught.filter(objective =>
    !objective.assessed ||
    objective.status === 'failed' ||
    objective.status === 'recovery_required',
  )
  return {
    sessionId,
    version,
    objectives,
    taughtObjectiveIds: taught.map(objective => objective.objectiveId),
    assessedObjectiveIds: assessed.map(objective => objective.objectiveId),
    demonstratedObjectiveIds: demonstrated.map(objective => objective.objectiveId),
    unresolvedObjectiveIds: unresolved.map(objective => objective.objectiveId),
    coverageRatio: taught.length === 0 ? 1 : assessed.length / taught.length,
  }
}

export function buildAssessmentBlueprint(
  steps: AssessmentStepDeclaration[],
  sessionId: string,
  version = 1,
): AssessmentBlueprint {
  const objectives: AssessmentObjective[] = []
  const seen = new Set<string>()
  for (const step of steps) {
    const declaredFacts = [...new Set(
      (step.factKeys?.length ? step.factKeys : step.relatedBlockIds?.length ? step.relatedBlockIds : [step.id])
        .map(String)
        .filter(Boolean),
    )]
    const declaredIds = step.objectiveIds?.length
      ? step.objectiveIds
      : declaredFacts.map(factKey => `${sessionId}:${step.id}:${factKey}`)
    declaredIds.forEach((objectiveId, index) => {
      if (!objectiveId || seen.has(objectiveId)) return
      seen.add(objectiveId)
      const factKey = declaredFacts[index] || declaredFacts[0] || step.id
      objectives.push({
        objectiveId,
        sessionId,
        stepId: step.id,
        microId: step.microId || factKey,
        factKeys: [factKey],
        cognitiveTarget: declaredDimension(step),
        importance: Number.isFinite(step.importance) ? Math.max(0, Math.min(1, Number(step.importance))) : 0.7,
        taught: true,
        practiced: false,
        assessed: false,
        independentlyCorrect: false,
        assistedCorrect: false,
        failedAttempts: 0,
        evidenceIds: [],
        status: 'not_assessed',
      })
    })
  }
  return refreshBlueprint(sessionId, version, objectives)
}

export const getUnassessedObjectives = (blueprint: AssessmentBlueprint): AssessmentObjective[] =>
  blueprint.objectives.filter(objective => objective.taught && !objective.assessed && !objective.subsumedByObjectiveId)

export const getUnresolvedObjectives = (blueprint: AssessmentBlueprint): AssessmentObjective[] =>
  blueprint.objectives.filter(objective => blueprint.unresolvedObjectiveIds.includes(objective.objectiveId))

export const calculateAssessmentCoverage = (blueprint: AssessmentBlueprint): number =>
  refreshBlueprint(blueprint.sessionId, blueprint.version, blueprint.objectives).coverageRatio

export function recordAssessmentEvidence(
  blueprint: AssessmentBlueprint,
  targetObjectiveIds: string[],
  result: { valid: boolean; correct: boolean; independent: boolean; evidenceId?: string },
): AssessmentBlueprint {
  const targets = new Set(targetObjectiveIds)
  const objectives = blueprint.objectives.map(objective => {
    if (!targets.has(objective.objectiveId) || !result.valid) return objective
    const independentlyCorrect = objective.independentlyCorrect || (result.correct && result.independent)
    return {
      ...objective,
      practiced: true,
      assessed: true,
      independentlyCorrect,
      assistedCorrect: objective.assistedCorrect || (result.correct && !result.independent),
      failedAttempts: objective.failedAttempts + (result.correct ? 0 : 1),
      evidenceIds: result.evidenceId && !objective.evidenceIds.includes(result.evidenceId)
        ? [...objective.evidenceIds, result.evidenceId]
        : objective.evidenceIds,
      status: independentlyCorrect
        ? 'demonstrated' as const
        : result.correct
          ? 'in_progress' as const
          : 'recovery_required' as const,
    }
  })
  return refreshBlueprint(blueprint.sessionId, blueprint.version, objectives)
}

export function canCompleteSessionFromAssessment(
  blueprint: AssessmentBlueprint,
  activeRecoveryTargetIds: string[] = [],
): boolean {
  return calculateAssessmentCoverage(blueprint) === 1 &&
    getUnresolvedObjectives(blueprint).length === 0 &&
    activeRecoveryTargetIds.length === 0
}

function compatibleTypes(objective: AssessmentObjective, quick: boolean): string[] {
  if (objective.cognitiveTarget === 'application' || objective.cognitiveTarget === 'transfer') {
    return quick
      ? ['scenario', 'matching', 'ordering', 'find_the_error', 'multi_select']
      : ['scenario', 'numeric_problem', 'short_response', 'matching']
  }
  if (objective.cognitiveTarget === 'comprehension') {
    return ['multiple_choice', 'matching', 'classify', 'scenario']
  }
  return ['multiple_choice', 'true_false', 'word_bank', 'classify']
}

export function planAssessmentQuestions(input: {
  objectives: AssessmentObjective[]
  evaluationPreference: unknown
  urgency?: unknown
  finalReview?: boolean
  priorEvidence?: unknown
  recentQuestionHistory?: unknown
}): AssessmentQuestionPlan {
  const pending = input.objectives.filter(objective => objective.taught && !objective.assessed)
  const quick = String(input.evaluationPreference) === 'quick_test'
  const finalReviewTypes = [
    ['scenario', 'multi_select'],
    ['multiple_choice', 'find_the_error'],
    ['matching', 'classify'],
  ]
  const plannedQuestions = pending.map((objective, index) => ({
    plannedQuestionId: `planned:${objective.objectiveId}`,
    targetObjectiveIds: [objective.objectiveId],
    preferredTypes: input.finalReview && index < finalReviewTypes.length
      ? finalReviewTypes[index]
      : compatibleTypes(objective, quick),
    rationale: `Obtener evidencia ${objective.cognitiveTarget} para el objetivo enseñado ${objective.objectiveId}.`,
  }))
  return {
    plannedQuestions,
    projectedCoverage: input.objectives.length === 0
      ? 1
      : (input.objectives.length - pending.length + plannedQuestions.length) / input.objectives.length,
  }
}

const sameSet = (left: string[], right: string[]): boolean =>
  left.length === right.length && new Set(left).size === new Set(right).size &&
  left.every(value => right.includes(value))

export function validateQuestionAgainstAssessmentBlueprint(
  question: AssessmentQuestionTarget,
  blueprint: AssessmentBlueprint,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!question.targetObjectiveIds.length) errors.push('ASSESSMENT_OBJECTIVES_REQUIRED')
  const objectives = question.targetObjectiveIds
    .map(id => blueprint.objectives.find(objective => objective.objectiveId === id))
  if (objectives.some(objective => !objective)) errors.push('ASSESSMENT_OBJECTIVE_NOT_FOUND')
  const validObjectives = objectives.filter((objective): objective is AssessmentObjective => Boolean(objective))
  const allowedFacts = new Set(validObjectives.flatMap(objective => objective.factKeys))
  if (!question.factKeys.length || question.factKeys.some(factKey => !allowedFacts.has(factKey))) {
    errors.push('ASSESSMENT_FACT_KEY_MISMATCH')
  }
  if (validObjectives.some(objective => objective.microId !== question.microId)) {
    errors.push('ASSESSMENT_MICRO_MISMATCH')
  }
  if (validObjectives.some(objective => objective.cognitiveTarget !== question.cognitiveTarget)) {
    errors.push('ASSESSMENT_COGNITIVE_MISMATCH')
  }
  if (/\bpaso\s+\d+\b/i.test(question.questionText || '')) errors.push('UNVERIFIED_STEP_REFERENCE')
  return { valid: errors.length === 0, errors }
}

export const validateQuestionEvidenceAlignment = validateQuestionAgainstAssessmentBlueprint
export const validateQuestionCognitiveAlignment = validateQuestionAgainstAssessmentBlueprint

export function validateRecoveryAlignment(
  source: AssessmentQuestionTarget,
  recovery: AssessmentQuestionTarget,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!sameSet(source.targetObjectiveIds, recovery.targetObjectiveIds) ||
      !sameSet(source.factKeys, recovery.factKeys) ||
      source.microId !== recovery.microId ||
      source.cognitiveTarget !== recovery.cognitiveTarget) errors.push('RECOVERY_TARGET_DRIFT')
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

export function assertRecoveryPreservesTarget(
  source: AssessmentQuestionTarget,
  recovery: AssessmentQuestionTarget,
): void {
  if (!validateRecoveryAlignment(source, recovery).valid) throw new Error('RECOVERY_TARGET_DRIFT')
}

export const validateRecoveryQuestionAgainstSourceFailure = validateRecoveryAlignment
