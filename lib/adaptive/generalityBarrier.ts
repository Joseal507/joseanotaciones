import type { SessionEvaluationKind, StepImportance } from './evaluation/sessionEvaluation'

export interface MaterialInvariantStep {
  id: string
  keyPointIds: string[]
  importance: StepImportance
}

export interface MaterialInvariantBlock {
  id: string
  coveredStepIds: string[]
  coveredKeyPointIds: string[]
  questionTargetStepIds: string[][]
  questionTargetKeyPointIds: string[][]
}

export interface MaterialInvariantSession {
  kind: SessionEvaluationKind
  steps: MaterialInvariantStep[]
  evaluationBlocks: MaterialInvariantBlock[]
  producesEvidence?: boolean
  opensRecovery?: boolean
  awardsMastery?: boolean
}

export interface MaterialInvariantResult {
  valid: boolean
  errors: string[]
  requiredObjectiveCount: number
  coveredObjectiveCount: number
}

export function validateMaterialInvariantSession(session: MaterialInvariantSession): MaterialInvariantResult {
  const errors: string[] = []
  const stepIds = session.steps.map(step => step.id)
  const stepIdSet = new Set(stepIds)
  const allKeyPointIds = session.steps.flatMap(step => step.keyPointIds)
  const keyPointIdSet = new Set(allKeyPointIds)

  if (stepIds.some(id => !id) || new Set(stepIds).size !== stepIds.length) errors.push('STEP_IDS_MUST_BE_STABLE_AND_UNIQUE')
  if (allKeyPointIds.some(id => !id) || new Set(allKeyPointIds).size !== allKeyPointIds.length) errors.push('KEY_POINT_IDS_MUST_BE_STABLE_AND_UNIQUE')

  if (session.kind === 'introduction') {
    if (session.steps.length < 3 || session.steps.length > 5) errors.push('INTRODUCTION_STEP_COUNT_MUST_BE_3_TO_5')
    if (session.evaluationBlocks.length) errors.push('INTRODUCTION_EVALUATION_FORBIDDEN')
    if (session.producesEvidence) errors.push('INTRODUCTION_EVIDENCE_FORBIDDEN')
    if (session.opensRecovery) errors.push('INTRODUCTION_RECOVERY_FORBIDDEN')
    if (session.awardsMastery) errors.push('INTRODUCTION_MASTERY_FORBIDDEN')
  }

  if (session.kind === 'final_review') {
    if (session.evaluationBlocks.length) errors.push('FINAL_REVIEW_EVALUATION_FORBIDDEN')
    if (session.producesEvidence) errors.push('FINAL_REVIEW_EVIDENCE_FORBIDDEN')
    if (session.opensRecovery) errors.push('FINAL_REVIEW_RECOVERY_FORBIDDEN')
    if (session.awardsMastery) errors.push('FINAL_REVIEW_MASTERY_FORBIDDEN')
  }

  const requiredKeyPointIds = session.kind === 'learning'
    ? session.steps.filter(step => step.importance !== 'supporting').flatMap(step => step.keyPointIds)
    : []
  const covered = new Set<string>()

  if (session.kind === 'learning') {
    if (!session.steps.length) errors.push('LEARNING_REQUIRES_TEACHING_STEP')
    if (!session.evaluationBlocks.length) errors.push('LEARNING_REQUIRES_EVALUATION_BLOCK')
    for (const block of session.evaluationBlocks) {
      if (!block.id) errors.push('EVALUATION_BLOCK_ID_REQUIRED')
      if (block.coveredStepIds.some(id => !stepIdSet.has(id))) errors.push('UNKNOWN_OR_FUTURE_STEP_ID')
      if (block.coveredKeyPointIds.some(id => !keyPointIdSet.has(id))) errors.push('UNKNOWN_KEY_POINT_ID')
      for (const targets of block.questionTargetStepIds) {
        if (!targets.length || targets.some(id => !block.coveredStepIds.includes(id))) errors.push('QUESTION_OUTSIDE_BLOCK')
      }
      for (const targets of block.questionTargetKeyPointIds) {
        if (!targets.length || targets.some(id => !block.coveredKeyPointIds.includes(id))) errors.push('QUESTION_KEY_POINT_OUTSIDE_BLOCK')
        targets.forEach(id => covered.add(id))
      }
    }
    if (requiredKeyPointIds.some(id => !covered.has(id))) errors.push('REQUIRED_OBJECTIVE_COVERAGE_INCOMPLETE')
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    requiredObjectiveCount: requiredKeyPointIds.length,
    coveredObjectiveCount: requiredKeyPointIds.filter(id => covered.has(id)).length,
  }
}
