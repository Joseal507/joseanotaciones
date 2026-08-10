import { questionSimilarity, realFactKeysOf, type CanonicalQuestion, type CanonicalUserAnswer, type EvaluationOutcome } from './questionContract'
import type { AssistanceLevel } from '../v3/engine/helpContract'

export const REQUIRED_INDEPENDENT_RECOVERY_CHECKS = 2
// Operaciones completas del pipeline IA. Cada operación ya contiene reparación,
// simplificación, split y cambio de proveedor; no es un límite pedagógico.
export const MAX_VERIFICATION_GENERATION_ATTEMPTS = 99 // sin límite pedagógico
export const RECOVERY_SEMANTIC_EQUIVALENCE_THRESHOLD = 0.92

export type RecoveryStatus =
  | 'pending_reteach'
  | 'reteaching'
  | 'pending_verification'
  | 'verification_ready'
  | 'verification_active'
  | 'resolved'
  | 'unresolved'

export type RecoveryNextAction =
  | 'reteach'
  | 'generate_verification'
  | 'answer_verification'
  | 'continue_recovery'
  | 'continue_session'

export interface RecoveryFailure {
  question: CanonicalQuestion
  answer: CanonicalUserAnswer
  result: { outcome?: EvaluationOutcome; correct?: boolean; errorType?: string | null; feedback?: string }
}

export interface RecoveryFailureEvidence {
  evidenceId: string
  questionId: string
  factKey: string
  studentAnswer: CanonicalUserAnswer
  expectedAnswer: CanonicalUserAnswer
  errorType: string | null
  assistanceLevel: AssistanceLevel
  createdAt: number
}

export interface RecoveryCheck {
  question: CanonicalQuestion
  outcome: EvaluationOutcome
  correct: boolean
  assistanceLevel: AssistanceLevel
  counted: boolean
  repeatedQuestion: boolean
  repeatedFactKey: boolean
}

export interface RecoveryVerificationQuestion {
  recoveryId: string
  roundId: string
  question: CanonicalQuestion
  generatedAt: number
  persistedAt: number
  presentedAt: number | null
  answeredAt: number | null
  evidenceId: string | null
}

export interface RecoveryItem {
  recoveryId: string
  recoveryTargetId: string
  roundId: string
  roundNumber: number
  sourceQuestionId: string
  sourceStepIds: string[]
  sourceKeyPoints: string[]
  microId: string
  cognitiveTarget: string
  targetObjectiveIds: string[]
  conceptId: string
  conceptLabel: string
  sourceQuestionIds: string[]
  sourceFactKeys: string[]
  failureEvidenceIds: string[]
  failures: RecoveryFailure[]
  failureHistory: RecoveryFailureEvidence[]
  latestFailureEvidenceId: string
  latestQuestionId: string
  latestStudentAnswer: CanonicalUserAnswer
  latestExpectedAnswer: CanonicalUserAnswer
  latestErrorType: string | null
  latestFactKeys: string[]
  originalExplanation: string
  latestFailedVerification: RecoveryFailureEvidence | null
  latestAssistanceLevel: AssistanceLevel
  reteachAttempt: number
  verificationGenerationAttempts: number
  verificationGenerationVersion: number
  validVerificationAttempts: number
  totalRecoveryInteractions: number
  maxVerificationGenerationAttempts: number
  requiredIndependentChecks: number
  verificationRound: number
  totalStudentFailureRounds: number
  completedIndependentChecks: number
  successfulIndependentChecks: number
  deferredUntilNormalBlockComplete: boolean
  strategyHistory: string[]
  reteachContentHistory: string[]
  preparedReteachContent: string | null
  technicalStatus?: 'ready' | 'technical_retry_required'
  activeGenerationKey?: string | null
  acceptedPartialExplanation?: string | null
  acceptedPartialQuestions?: CanonicalQuestion[]
  technicalRetryCount?: number
  lastTechnicalError?: string | null
  preparedAt?: number | null
  presentedAt?: number | null
  lastReteachFailureEvidenceId: string | null
  checks: RecoveryCheck[]
  verificationQuestions: RecoveryVerificationQuestion[]
  status: RecoveryStatus
  reason: string
  unresolvedReason?: string
}

export interface RecoveryTelemetry {
  recoveryId: string
  roundId: string
  microId: string
  conceptId: string
  reteachAttempt: number
  strategy: string
  requiredChecks: number
  validChecks: number
  successfulChecks: number
  assistanceLevel: AssistanceLevel
  repeatedQuestion: boolean
  repeatedFactKey: boolean
  resolved: boolean
  unresolved: boolean
  reason: string
  generatedQuestions: number
  presentedQuestions: number
  answeredQuestions: number
  generatedButNeverPresented: number
}

export interface RecoveryVisibilityAudit {
  generatedQuestions: number
  presentedQuestions: number
  answeredQuestions: number
  generatedButNeverPresented: number
}

export interface RecoveryCompletionAudit {
  skippedRecovery: number
  reteachWithoutTwoAnsweredVerifications: number
}

const isOpen = (item: RecoveryItem): boolean => item.status !== 'resolved'

const questionTargets = (question: CanonicalQuestion): { stepIds: string[]; keyPoints: string[]; factKeys: string[] } => {
  const targeted = question as CanonicalQuestion & { coveredStepIds?: string[]; coveredKeyPoints?: string[] }
  return {
    stepIds: targeted.coveredStepIds?.length ? [...new Set(targeted.coveredStepIds)] : [question.teachingBlockId],
    keyPoints: targeted.coveredKeyPoints?.length ? [...new Set(targeted.coveredKeyPoints)] : [],
    factKeys: realFactKeysOf(question),
  }
}

const sameSet = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every(value => right.includes(value))

export function validateRecoveryTargetAlignment(
  item: RecoveryItem,
  question: CanonicalQuestion,
): { valid: boolean; errors: string[] } {
  const target = questionTargets(question)
  const valid = question.conceptId === item.microId &&
    question.targetDimension === item.cognitiveTarget &&
    sameSet(item.sourceStepIds, target.stepIds) &&
    sameSet(item.sourceKeyPoints, target.keyPoints) &&
    sameSet(item.sourceFactKeys, target.factKeys)
  return valid ? { valid: true, errors: [] } : { valid: false, errors: ['RECOVERY_TARGET_DRIFT'] }
}

const evidenceId = (questionId: string, sequence: number): string =>
  `failure:${questionId}:${sequence}`

function failureEvidence(
  failure: RecoveryFailure,
  sequence: number,
  assistanceLevel: AssistanceLevel = 'independent',
): RecoveryFailureEvidence {
  return {
    evidenceId: evidenceId(failure.question.id, sequence),
    questionId: failure.question.id,
    factKey: failure.question.factKey,
    studentAnswer: failure.answer,
    expectedAnswer: failure.question.correctAnswer,
    errorType: failure.result.errorType || null,
    assistanceLevel,
    createdAt: Date.now(),
  }
}

export function createRecoveryQueue(failures: RecoveryFailure[]): RecoveryItem[] {
  const queue: RecoveryItem[] = []
  for (const failure of failures) {
    if (failure.result.outcome === 'invalid') continue
    const microId = failure.question.conceptId
    const cognitiveTarget = failure.question.targetDimension
    const recoveryTargetId = `recovery:${microId}:${failure.question.id}:${cognitiveTarget}:${failure.question.factKey}`
    const existing = queue.find(item => item.recoveryTargetId === recoveryTargetId)
    if (existing) {
      const evidence = failureEvidence(failure, existing.failureHistory.length + 1)
      existing.failures.push(failure)
      existing.failureHistory.push(evidence)
      existing.failureEvidenceIds.push(evidence.evidenceId)
      existing.latestFailureEvidenceId = evidence.evidenceId
      existing.latestQuestionId = evidence.questionId
      existing.latestStudentAnswer = evidence.studentAnswer
      existing.latestExpectedAnswer = evidence.expectedAnswer
      existing.latestErrorType = evidence.errorType
      existing.latestFactKeys = [evidence.factKey]
      existing.latestAssistanceLevel = evidence.assistanceLevel
      if (!existing.sourceQuestionIds.includes(failure.question.id)) existing.sourceQuestionIds.push(failure.question.id)
      for (const realFactKey of questionTargets(failure.question).factKeys) {
        if (!existing.sourceFactKeys.includes(realFactKey)) existing.sourceFactKeys.push(realFactKey)
      }
      continue
    }
    const evidence = failureEvidence(failure, 1)
    const target = questionTargets(failure.question)
    queue.push({
      recoveryId: recoveryTargetId,
      recoveryTargetId,
      roundId: `${recoveryTargetId}:round:0`,
      roundNumber: 0,
      sourceQuestionId: failure.question.id,
      sourceStepIds: target.stepIds,
      sourceKeyPoints: target.keyPoints,
      microId,
      cognitiveTarget,
      targetObjectiveIds: failure.question.targetObjectiveIds || [],
      conceptId: failure.question.conceptId,
      conceptLabel: failure.question.conceptLabel,
      sourceQuestionIds: [failure.question.id],
      sourceFactKeys: target.factKeys,
      failureEvidenceIds: [evidence.evidenceId],
      failures: [failure],
      failureHistory: [evidence],
      latestFailureEvidenceId: evidence.evidenceId,
      latestQuestionId: evidence.questionId,
      latestStudentAnswer: evidence.studentAnswer,
      latestExpectedAnswer: evidence.expectedAnswer,
      latestErrorType: evidence.errorType,
      latestFactKeys: [evidence.factKey],
      originalExplanation: failure.question.explanation,
      latestFailedVerification: null,
      latestAssistanceLevel: evidence.assistanceLevel,
      reteachAttempt: 0,
      verificationGenerationAttempts: 0,
      verificationGenerationVersion: 1,
      validVerificationAttempts: 0,
      totalRecoveryInteractions: 0,
      maxVerificationGenerationAttempts: MAX_VERIFICATION_GENERATION_ATTEMPTS,
      requiredIndependentChecks: REQUIRED_INDEPENDENT_RECOVERY_CHECKS,
      verificationRound: 0,
      totalStudentFailureRounds: 0,
      completedIndependentChecks: 0,
      successfulIndependentChecks: 0,
      deferredUntilNormalBlockComplete: false,
      strategyHistory: [],
      reteachContentHistory: [],
      preparedReteachContent: null,
      lastReteachFailureEvidenceId: null,
      checks: [],
      verificationQuestions: [],
      status: 'pending_reteach',
      reason: 'incorrect_answer',
    })
  }
  return queue
}

export function mergeRecoveryFailures(queue: RecoveryItem[], failures: RecoveryFailure[]): RecoveryItem[] {
  const additions = createRecoveryQueue(failures)
  const merged = structuredClone(queue)
  for (const addition of additions) {
    const current = merged.find(item => item.recoveryTargetId === addition.recoveryTargetId && isOpen(item))
    if (!current) {
      merged.push(addition)
      continue
    }
    for (const failure of addition.failures) {
      const evidence = failureEvidence(failure, current.failureHistory.length + 1)
      current.failures.push(failure)
      current.failureHistory.push(evidence)
      current.failureEvidenceIds.push(evidence.evidenceId)
      current.latestFailureEvidenceId = evidence.evidenceId
      current.latestQuestionId = evidence.questionId
      current.latestStudentAnswer = evidence.studentAnswer
      current.latestExpectedAnswer = evidence.expectedAnswer
      current.latestErrorType = evidence.errorType
      current.latestFactKeys = [evidence.factKey]
      current.latestAssistanceLevel = evidence.assistanceLevel
      current.sourceQuestionIds = [...new Set([...current.sourceQuestionIds, failure.question.id])]
      current.sourceFactKeys = [...new Set([...current.sourceFactKeys, ...questionTargets(failure.question).factKeys])]
    }
    current.status = 'pending_reteach'
    current.reason = 'new_failure_evidence'
  }
  return merged
}

export function deferNormalBlockFailures(
  queue: RecoveryItem[],
  failures: RecoveryFailure[],
): RecoveryItem[] {
  const merged = mergeRecoveryFailures(queue, failures)
  const failedMicros = new Set(
    failures
      .filter(failure => failure.result.outcome !== 'invalid')
      .map(failure => failure.question.conceptId),
  )
  return merged.map(item => failedMicros.has(item.microId) && isOpen(item)
    ? { ...item, deferredUntilNormalBlockComplete: true, reason: 'normal_block_in_progress' }
    : item)
}

export function releaseNormalBlockRecoveries(queue: RecoveryItem[]): RecoveryItem[] {
  return queue.map(item => item.deferredUntilNormalBlockComplete
    ? { ...item, deferredUntilNormalBlockComplete: false, reason: 'normal_block_completed' }
    : item)
}

export function latestRecoveryFailure(item: RecoveryItem): RecoveryFailure | null {
  for (let index = item.failures.length - 1; index >= 0; index--) {
    if (item.failures[index].question.id === item.latestQuestionId) return item.failures[index]
  }
  return null
}

export function beginRecoveryReteach(item: RecoveryItem, strategy: string): RecoveryItem {
  if (item.status !== 'pending_reteach' && item.status !== 'unresolved') {
    return { ...item, status: 'pending_reteach', reason: 'recovery_transition_repaired' }
  }
  return {
    ...item,
    reteachAttempt: item.reteachAttempt + 1,
    totalRecoveryInteractions: item.totalRecoveryInteractions + 1,
    strategyHistory: [...item.strategyHistory, strategy],
    lastReteachFailureEvidenceId: item.latestFailureEvidenceId,
    status: 'reteaching',
    reason: 'reteaching_latest_failure',
  }
}

export function selectRecoveryStrategy(item: RecoveryItem): string | null {
  const preferred = item.latestErrorType === 'procedure'
    ? ['worked_example_new_context', 'step_diagnosis', 'backward_chaining']
    : item.latestErrorType === 'ordering'
      ? ['sequence_contrast', 'dependency_map', 'backward_chaining']
      : item.latestErrorType === 'conceptual' || item.latestErrorType === 'comprehension'
        ? ['concept_boundary', 'counterexample', 'analogy_transfer']
        : ['contrastive_explanation', 'alternative_representation', 'new_context_application']
  const extended = [
    ...preferred,
    'direct_definition',
    'concrete_example',
    'causal_connection',
    'textual_visualization',
    'confused_concepts_comparison',
    'micro_skill_decomposition',
  ]
  const unused = extended.find(strategy => !item.strategyHistory.includes(strategy))
  return unused || `${extended[item.reteachAttempt % extended.length]}_iteration_${item.reteachAttempt + 1}`
}

const contentFingerprint = (content: string): string =>
  content.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim()

export function recordRecoveryReteachContent(item: RecoveryItem, content: string): RecoveryItem {
  if (item.status !== 'reteaching') return { ...item, status: 'pending_reteach', reason: 'reteach_transition_repaired' }
  const fingerprint = contentFingerprint(content)
  if (!fingerprint || item.reteachContentHistory.includes(fingerprint)) {
    // Auditoría adversarial (Codex, Reteach 3.1): un duplicado NUNCA debe poder
    // avanzar a verificación. Devolver status:'reteaching' aquí dejaba pasar
    // beginRecoveryVerification (su guard solo exige status==='reteaching', que
    // seguía siendo cierto) y persistRecoveryVerificationQuestions incluso
    // "auto-repara" a pending_verification si no lo estaba — ambos guards
    // downstream son permisivos por diseño, así que la única defensa real es
    // que ESTA función deje explícitamente el item en un estado que NO es
    // 'reteaching' (bloquea semánticamente el siguiente paso) y sin contenido
    // preparado de una ronda anterior (evita mostrar una explicación vieja
    // como si fuera nueva). El caller (page.tsx) además debe comprobar este
    // reason explícitamente antes de encadenar los siguientes pasos.
    return { ...item, status: 'pending_reteach', preparedReteachContent: null, reason: 'duplicate_reteach_requires_alternate_content' }
  }
  return {
    ...item,
    reteachContentHistory: [...item.reteachContentHistory, fingerprint],
    preparedReteachContent: content,
    reason: 'reteach_content_ready',
  }
}

export function beginRecoveryVerification(item: RecoveryItem): RecoveryItem {
  if (item.status !== 'reteaching') return { ...item, status: 'pending_reteach', reason: 'verification_requires_reteach' }
  const roundNumber = item.verificationRound + 1
  return {
    ...item,
    verificationRound: roundNumber,
    roundNumber,
    roundId: `${item.recoveryId}:round:${roundNumber}`,
    verificationGenerationAttempts: 0,
    completedIndependentChecks: 0,
    successfulIndependentChecks: 0,
    preparedReteachContent: item.preparedReteachContent,
    status: 'pending_verification',
    reason: 'awaiting_verification_generation',
  }
}

export function recordVerificationGenerationAttempt(
  item: RecoveryItem,
  generatedValidQuestion: boolean,
): RecoveryItem {
  if (item.status !== 'pending_verification' && item.status !== 'verification_active') {
    return { ...item, status: 'pending_verification', reason: 'verification_generation_transition_repaired' }
  }
  const attempts = item.verificationGenerationAttempts + 1
  const total = item.totalRecoveryInteractions + 1
  return {
    ...item,
    verificationGenerationAttempts: attempts,
    totalRecoveryInteractions: total,
    status: 'pending_verification',
    reason: generatedValidQuestion
      ? 'verification_candidates_generated'
      : attempts >= item.maxVerificationGenerationAttempts
        ? 'technical_generation_attempts_exhausted'
        : 'verification_generation_retry',
  }
}

export function activateRecoveryVerification(item: RecoveryItem): RecoveryItem {
  if (item.status !== 'pending_verification' && item.status !== 'verification_ready') {
    return { ...item, status: 'pending_verification', reason: 'verification_activation_repaired' }
  }
  return { ...item, status: 'verification_active', reason: 'verification_question_active' }
}

export function persistRecoveryVerificationQuestions(
  item: RecoveryItem,
  questions: CanonicalQuestion[],
  now = Date.now(),
): RecoveryItem {
  if (item.status !== 'pending_verification') {
    return { ...item, status: 'pending_verification', reason: 'verification_persistence_transition_repaired' }
  }
  const roundId = `${item.recoveryId}:round:${item.verificationRound}`
  const existingIds = new Set(item.verificationQuestions.map(entry => entry.question.id))
  const additions = questions
    .filter(question => !existingIds.has(question.id))
    .map(question => ({
      recoveryId: item.recoveryId,
      roundId,
      question,
      generatedAt: now,
      persistedAt: now,
      presentedAt: null,
      answeredAt: null,
      evidenceId: null,
    }))
  const verificationQuestions = [...item.verificationQuestions, ...additions]
  const pendingCount = verificationQuestions.filter(entry =>
    entry.roundId === roundId && entry.answeredAt === null,
  ).length
  const remainingRequired = Math.max(0, item.requiredIndependentChecks - item.completedIndependentChecks)
  const ready = pendingCount >= remainingRequired
  return {
    ...item,
    verificationQuestions,
    status: ready ? 'verification_ready' : 'pending_verification',
    reason: ready ? 'verification_questions_persisted' : 'verification_generation_retry',
  }
}

export function presentRecoveryVerificationQuestion(
  item: RecoveryItem,
  now = Date.now(),
): { item: RecoveryItem; question: CanonicalQuestion | null } {
  if (item.status !== 'verification_ready' && item.status !== 'verification_active' && item.status !== 'pending_verification') {
    return {
      item: { ...item, status: 'pending_verification', reason: 'verification_presentation_transition_repaired' },
      question: null,
    }
  }
  const roundId = `${item.recoveryId}:round:${item.verificationRound}`
  const index = item.verificationQuestions.findIndex(entry =>
    entry.roundId === roundId && entry.answeredAt === null,
  )
  if (index < 0) return { item: { ...item, status: 'pending_verification', reason: 'verification_replacement_required' }, question: null }
  const verificationQuestions = item.verificationQuestions.map((entry, entryIndex) =>
    entryIndex === index && entry.presentedAt === null ? { ...entry, presentedAt: now } : entry)
  return {
    item: { ...item, verificationQuestions, status: 'verification_active', reason: 'verification_question_presented' },
    question: verificationQuestions[index].question,
  }
}

export function prepareVerificationGenerationRetry(item: RecoveryItem): RecoveryItem {
  return {
    ...item,
    verificationGenerationVersion: item.verificationGenerationVersion + 1,
    status: 'pending_verification',
    reason: 'verification_generation_batch_failed',
    unresolvedReason: undefined,
  }
}

export function recordRecoveryCheck(
  item: RecoveryItem,
  question: CanonicalQuestion,
  result: { outcome: EvaluationOutcome; correct: boolean; errorType?: string | null },
  assistanceLevel: AssistanceLevel = 'independent',
  studentAnswer: CanonicalUserAnswer = '',
): { item: RecoveryItem; telemetry: RecoveryTelemetry } {
  if (item.status !== 'verification_active') {
    const stopped = { ...item, status: 'pending_verification' as const, reason: 'verification_answer_transition_repaired' }
    return { item: stopped, telemetry: recoveryTelemetry(stopped, assistanceLevel, false, false) }
  }
  const roundId = `${item.recoveryId}:round:${item.verificationRound}`
  const verificationIndex = item.verificationQuestions.findIndex(entry =>
    entry.roundId === roundId && entry.question.id === question.id && entry.answeredAt === null,
  )
  const wasPresented = verificationIndex >= 0 && item.verificationQuestions[verificationIndex].presentedAt !== null
  const deterministicFallback = question.questionFamily.startsWith('deterministic_recovery_')
  const repeatedQuestion = [...item.sourceQuestionIds, ...item.checks.map(check => check.question.id)].includes(question.id) ||
    (!deterministicFallback &&
      [...item.failures.map(failure => failure.question), ...item.checks.map(check => check.question)]
        .some(previous => questionSimilarity(previous, question) >= RECOVERY_SEMANTIC_EQUIVALENCE_THRESHOLD))
  const repeatedFactKey = item.checks.some(check =>
    check.question.factKey === question.factKey &&
    check.question.questionFamily === question.questionFamily &&
    questionSimilarity(check.question, question) >= RECOVERY_SEMANTIC_EQUIVALENCE_THRESHOLD,
  )
  const valid = result.outcome !== 'invalid'
  const counted = valid && wasPresented && !repeatedQuestion && !repeatedFactKey
  const independentSuccess = counted && result.correct && assistanceLevel === 'independent'
  const check: RecoveryCheck = { question, outcome: result.outcome, correct: result.correct, assistanceLevel, counted, repeatedQuestion, repeatedFactKey }
  const completed = item.completedIndependentChecks + (counted ? 1 : 0)
  const successful = item.successfulIndependentChecks + (independentSuccess ? 1 : 0)
  const validAttempts = item.validVerificationAttempts + (counted ? 1 : 0)
  const total = item.totalRecoveryInteractions + (valid ? 1 : 0)
  let updated: RecoveryItem = {
    ...item,
    checks: [...item.checks, check],
    completedIndependentChecks: completed,
    successfulIndependentChecks: successful,
    validVerificationAttempts: validAttempts,
    totalRecoveryInteractions: total,
  }

  if (verificationIndex >= 0) {
    const answerEvidenceId = counted ? `recovery-check:${item.recoveryId}:${item.verificationRound}:${question.id}` : null
    updated = {
      ...updated,
      verificationQuestions: updated.verificationQuestions.map((entry, index) => index === verificationIndex
        ? { ...entry, answeredAt: Date.now(), evidenceId: answerEvidenceId }
        : entry),
    }
  }

  if (counted && !result.correct) {
    const failure: RecoveryFailure = {
      question,
      answer: studentAnswer,
      result: { outcome: result.outcome, correct: false, errorType: result.errorType || null },
    }
    const evidence = failureEvidence(failure, item.failureHistory.length + 1, assistanceLevel)
    updated = {
      ...updated,
      failures: [...updated.failures, failure],
      failureHistory: [...updated.failureHistory, evidence],
      failureEvidenceIds: [...updated.failureEvidenceIds, evidence.evidenceId],
      latestFailureEvidenceId: evidence.evidenceId,
      latestQuestionId: evidence.questionId,
      latestStudentAnswer: evidence.studentAnswer,
      latestExpectedAnswer: evidence.expectedAnswer,
      latestErrorType: evidence.errorType,
      latestFactKeys: [evidence.factKey],
      latestAssistanceLevel: evidence.assistanceLevel,
      latestFailedVerification: evidence,
    }
  }

  const roundComplete = completed >= item.requiredIndependentChecks
  const roundPassed = roundComplete && successful >= item.requiredIndependentChecks
  if (roundPassed) {
    updated = { ...updated, status: 'resolved', reason: 'current_round_independent_checks_met' }
  } else if (!valid) {
    updated = { ...updated, status: 'pending_verification', reason: 'invalid_question_not_counted' }
  } else if (!wasPresented) {
    updated = { ...updated, status: 'pending_verification', reason: 'unpresented_question_not_counted' }
  } else if (repeatedQuestion || repeatedFactKey) {
    updated = { ...updated, status: 'pending_verification', reason: 'repeated_evidence_not_counted' }
  } else if (roundComplete) {
    updated = {
      ...updated,
      totalStudentFailureRounds: updated.totalStudentFailureRounds + 1,
      status: 'pending_reteach',
      reason: 'verification_round_failed',
    }
  } else {
    updated = {
      ...updated,
      status: 'pending_verification',
      reason: 'finish_current_verification_round',
    }
  }

  return {
    item: updated,
    telemetry: recoveryTelemetry(updated, assistanceLevel, repeatedQuestion, repeatedFactKey),
  }
}

export function recoveryVisibilityAudit(item: RecoveryItem): RecoveryVisibilityAudit {
  const roundId = `${item.recoveryId}:round:${item.verificationRound}`
  const roundQuestions = item.verificationQuestions.filter(entry => entry.roundId === roundId)
  return {
    generatedQuestions: roundQuestions.length,
    presentedQuestions: roundQuestions.filter(entry => entry.presentedAt !== null).length,
    answeredQuestions: roundQuestions.filter(entry => entry.answeredAt !== null).length,
    generatedButNeverPresented: roundQuestions.filter(entry => entry.presentedAt === null).length,
  }
}

export function recoveryCompletionAudit(queue: RecoveryItem[]): RecoveryCompletionAudit {
  return {
    skippedRecovery: queue.filter(item => isOpen(item)).length,
    reteachWithoutTwoAnsweredVerifications: queue.filter(item => {
      if (item.status !== 'resolved' || item.reteachAttempt < 1) return false
      const roundId = `${item.recoveryId}:round:${item.verificationRound}`
      const answered = item.verificationQuestions.filter(entry =>
        entry.roundId === roundId &&
        entry.presentedAt !== null &&
        entry.answeredAt !== null,
      ).length
      return answered < item.requiredIndependentChecks
    }).length,
  }
}

function recoveryTelemetry(
  item: RecoveryItem,
  assistanceLevel: AssistanceLevel,
  repeatedQuestion: boolean,
  repeatedFactKey: boolean,
): RecoveryTelemetry {
  const roundId = `${item.recoveryId}:round:${item.verificationRound}`
  return {
    recoveryId: item.recoveryId,
    roundId,
    microId: item.microId,
    conceptId: item.conceptId,
    reteachAttempt: item.reteachAttempt,
    strategy: item.strategyHistory.at(-1) || 'unspecified',
    requiredChecks: item.requiredIndependentChecks,
    validChecks: item.validVerificationAttempts,
    successfulChecks: item.successfulIndependentChecks,
    assistanceLevel,
    repeatedQuestion,
    repeatedFactKey,
    resolved: item.status === 'resolved',
    unresolved: item.status === 'unresolved',
    reason: item.reason,
    ...recoveryVisibilityAudit(item),
  }
}

export function recoveryDirective(item: RecoveryItem): {
  nextAction: RecoveryNextAction
  recoveryStatus: RecoveryStatus
  remainingChecks: number
  unresolvedReason?: string
} {
  const nextAction: RecoveryNextAction =
    item.status === 'pending_reteach' || item.status === 'unresolved' ? 'reteach'
      : item.status === 'reteaching' ? 'generate_verification'
        : item.status === 'pending_verification' ? 'generate_verification'
          : item.status === 'verification_ready' ? 'answer_verification'
          : item.status === 'verification_active' ? 'answer_verification'
            : 'continue_session'
  return {
    nextAction,
    recoveryStatus: item.status,
    remainingChecks: item.status === 'pending_reteach' || item.status === 'unresolved' || item.status === 'reteaching'
      ? item.requiredIndependentChecks
      : Math.max(0, item.requiredIndependentChecks - item.completedIndependentChecks),
    ...(item.unresolvedReason ? { unresolvedReason: item.unresolvedReason } : {}),
  }
}

export function normalizeRestoredRecoveryItem(item: RecoveryItem): RecoveryItem {
  const failures = Array.isArray(item.failures) ? item.failures : []
  const latestFailure = failures.at(-1)
  const history = Array.isArray(item.failureHistory) ? item.failureHistory : []
  const latestEvidence = history.at(-1)
  const normalized: RecoveryItem = {
    ...item,
    sourceQuestionIds: Array.isArray(item.sourceQuestionIds) ? item.sourceQuestionIds : failures.map(failure => failure.question.id),
    recoveryId: item.recoveryId || `recovery:${item.conceptId}:${failures[0]?.question.id || item.microId}`,
    recoveryTargetId: item.recoveryTargetId || item.recoveryId || `recovery:${item.conceptId}:${failures[0]?.question.id || item.microId}`,
    roundId: item.roundId || `${item.recoveryId}:round:${Number.isFinite(item.verificationRound) ? item.verificationRound : 0}`,
    roundNumber: Number.isFinite(item.roundNumber) ? item.roundNumber : Number(item.verificationRound || 0),
    sourceQuestionId: item.sourceQuestionId || failures[0]?.question.id || '',
    sourceStepIds: Array.isArray(item.sourceStepIds)
      ? item.sourceStepIds
      : latestFailure ? questionTargets(latestFailure.question).stepIds : [],
    sourceKeyPoints: Array.isArray(item.sourceKeyPoints)
      ? item.sourceKeyPoints
      : latestFailure ? questionTargets(latestFailure.question).keyPoints : [],
    cognitiveTarget: item.cognitiveTarget || latestFailure?.question.targetDimension || 'comprehension',
    targetObjectiveIds: Array.isArray(item.targetObjectiveIds)
      ? item.targetObjectiveIds
      : latestFailure?.question.targetObjectiveIds || [],
    sourceFactKeys: Array.isArray(item.sourceFactKeys)
      ? item.sourceFactKeys
      : [...new Set(failures.flatMap(failure => questionTargets(failure.question).factKeys))],
    failureEvidenceIds: Array.isArray(item.failureEvidenceIds) ? item.failureEvidenceIds : history.map(evidence => evidence.evidenceId),
    failures,
    failureHistory: history,
    latestFailureEvidenceId: item.latestFailureEvidenceId || latestEvidence?.evidenceId || '',
    latestQuestionId: item.latestQuestionId || latestFailure?.question.id || '',
    latestStudentAnswer: item.latestStudentAnswer ?? latestFailure?.answer ?? '',
    latestExpectedAnswer: item.latestExpectedAnswer ?? latestFailure?.question.correctAnswer ?? '',
    latestErrorType: item.latestErrorType ?? latestFailure?.result.errorType ?? null,
    latestFactKeys: Array.isArray(item.latestFactKeys)
      ? item.latestFactKeys
      : latestFailure ? [latestFailure.question.factKey] : [],
    originalExplanation: item.originalExplanation || failures[0]?.question.explanation || '',
    latestFailedVerification: item.latestFailedVerification || null,
    latestAssistanceLevel: item.latestAssistanceLevel || 'independent',
    reteachAttempt: Number.isFinite(item.reteachAttempt) ? item.reteachAttempt : 0,
    verificationGenerationAttempts: Number.isFinite(item.verificationGenerationAttempts) ? item.verificationGenerationAttempts : 0,
    verificationGenerationVersion: Number.isFinite(item.verificationGenerationVersion)
      ? item.verificationGenerationVersion
      : 1,
    validVerificationAttempts: Number.isFinite(item.validVerificationAttempts) ? item.validVerificationAttempts : 0,
    totalRecoveryInteractions: Number.isFinite(item.totalRecoveryInteractions) ? item.totalRecoveryInteractions : 0,
    maxVerificationGenerationAttempts: Number.isFinite(item.maxVerificationGenerationAttempts)
      ? item.maxVerificationGenerationAttempts
      : MAX_VERIFICATION_GENERATION_ATTEMPTS,
    requiredIndependentChecks: Number.isFinite(item.requiredIndependentChecks)
      ? item.requiredIndependentChecks
      : REQUIRED_INDEPENDENT_RECOVERY_CHECKS,
    verificationRound: Number.isFinite(item.verificationRound) ? item.verificationRound : 0,
    totalStudentFailureRounds: Number.isFinite(item.totalStudentFailureRounds) ? item.totalStudentFailureRounds : 0,
    completedIndependentChecks: Number.isFinite(item.completedIndependentChecks) ? item.completedIndependentChecks : 0,
    successfulIndependentChecks: Number.isFinite(item.successfulIndependentChecks) ? item.successfulIndependentChecks : 0,
    deferredUntilNormalBlockComplete: item.deferredUntilNormalBlockComplete === true,
    strategyHistory: Array.isArray(item.strategyHistory) ? item.strategyHistory : [],
    reteachContentHistory: Array.isArray(item.reteachContentHistory) ? item.reteachContentHistory : [],
    preparedReteachContent: typeof item.preparedReteachContent === 'string' ? item.preparedReteachContent : null,
    lastReteachFailureEvidenceId: item.lastReteachFailureEvidenceId || null,
    checks: Array.isArray(item.checks) ? item.checks : [],
    verificationQuestions: Array.isArray(item.verificationQuestions) ? item.verificationQuestions : [],
    reason: item.reason || 'restored_recovery',
  }
  if (normalized.status === 'verification_active') {
    return normalized.verificationQuestions.some(entry =>
      entry.roundId === `${normalized.recoveryId}:round:${normalized.verificationRound}` &&
      entry.answeredAt === null)
      ? { ...normalized, status: 'verification_ready', reason: 'restore_verification_ready' }
      : { ...normalized, status: 'pending_verification', reason: 'restore_requires_verification_question' }
  }
  if (normalized.status === 'pending_verification' && normalized.verificationQuestions.some(entry =>
    entry.roundId === `${normalized.recoveryId}:round:${normalized.verificationRound}` &&
    entry.answeredAt === null)) {
    return { ...normalized, status: 'verification_ready', reason: 'restore_persisted_verification_ready' }
  }
  if (normalized.status === 'reteaching') {
    return normalized.reteachContentHistory.length > 0
      ? { ...normalized, status: 'pending_verification', reason: 'restore_after_reteach' }
      : { ...normalized, status: 'pending_reteach', reason: 'restore_reteach_not_completed' }
  }
  if (normalized.status === 'unresolved') {
    return { ...normalized, status: 'pending_reteach', reason: 'legacy_unresolved_reopened', unresolvedReason: undefined }
  }
  return normalized
}

export const hasPendingRecovery = (queue: RecoveryItem[]): boolean => queue.some(isOpen)
export const nextRecoveryItem = (queue: RecoveryItem[]): RecoveryItem | null =>
  queue.find(item => isOpen(item) && !item.deferredUntilNormalBlockComplete) || null
export const canCompleteSessionWithRecovery = (queue: RecoveryItem[]): boolean => !hasPendingRecovery(queue)
export const canCompleteProgramWithRecovery = (queue: RecoveryItem[], requiredMicroIds: string[]): boolean => {
  const required = new Set(requiredMicroIds)
  return !queue.some(item => required.has(item.microId) && item.status !== 'resolved')
}
