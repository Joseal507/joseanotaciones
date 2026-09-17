import type { SourceEvidence } from '../../materials/sourceEvidence'
import type { QuizQuestion, QuizQuestionType } from '../../types/quiz'
import type { BrainScope, KnowledgeUnitKind } from '../types'

export const QUIZ_SCHEMA_VERSION = '3.0.0'
export const QUIZ_PLANNER_VERSION = '3.1.0'
export const QUIZ_GENERATOR_VERSION = '3.1.0'
export const QUIZ_PRESENTATION_VERSION = '3.0.0'
export const QUIZ_MANIFEST_VERSION = '1.0.0'
export const QUIZ_RECOVERY_MAX_ATTEMPTS_PER_SLOT = 3

/**
 * Global provider-attempt safety budget for a single Quiz generation.
 *
 * Contract:
 *   initial clean allowance = ⌈N / batchSize⌉
 *   technical repair allowance = initial clean allowance
 *   academic recovery allowance = max(3, ⌈N / 16⌉)
 *   total = 2 * ⌈N / batchSize⌉ + max(3, ⌈N / 16⌉)
 *
 * At batchSize=8: N=10 → 7, N=20 → 9, N=50 → 18, N=100 → 33.
 *
 * We count ATTEMPTED provider invocations (including repairs and failures),
 * not accepted questions. Reaching the cap → RECOVERY_BUDGET_EXHAUSTED.
 */
export const QUIZ_DEFAULT_BATCH_SIZE = 8
export function computeQuizProviderBudget(requestedCount: number, batchSize: number = QUIZ_DEFAULT_BATCH_SIZE): number {
  const initialBatches = Math.max(1, Math.ceil(requestedCount / Math.max(1, batchSize)))
  const academicRecoveryAllowance = Math.max(3, Math.ceil(requestedCount / 16))
  return initialBatches * 2 + academicRecoveryAllowance
}

export type QuizDifficulty = 'easy' | 'medium' | 'hard'

export interface QuizConfig {
  questionCount: number
  difficulty: QuizDifficulty
  questionTypes: QuizQuestionType[]
  language?: string
}

export interface QuizPlanSlot {
  slotId: string
  order: number
  questionType: QuizQuestionType
  difficulty: QuizDifficulty
  primaryCandidateId: string
}

/**
 * EvidenceLink binds a specific assertion (unit id OR relation id) to the
 * SourceEvidence that authoritatively supports it. Validation uses ONLY
 * assertions whose EvidenceLink resolves against authorized selectedPages.
 */
export interface EvidenceLink {
  kind: 'unit' | 'relation'
  refId: string
  evidence: SourceEvidence[]
  assertions: EvidenceBackedAssertion[]
}

export interface EvidenceBackedAssertion {
  assertionId: string
  kind: 'unit' | 'relation'
  refId: string
  text: string
  evidence: SourceEvidence[]
  supportMode: 'text_quote' | 'visual_description'
  assertionFingerprint: string
}

export type AnswerTargetKind = 'single_text' | 'multi_text' | 'pairs' | 'boolean'

export interface AnswerTarget {
  kind: AnswerTargetKind
  assertionIds: string[]
  canonicalValue?: string
  acceptedSurfaceForms?: string[]
  canonicalValues?: string[]
  pairTargets?: Array<{
    leftAssertionId: string
    rightAssertionId: string
    leftCanonical: string
    rightCanonical: string
  }>
  trueFalseMutation?: {
    mutationKind: string
    originalCanonicalValue: string
    mutatedValue: string
  }
}

export interface GroundingTarget {
  evidenceBackedAssertionIds: string[]
  sourceUnitIds: string[]
  sourceRelationIds: string[]
}

export type QuizCognitiveIntent = 'recall' | 'discriminate' | 'integrate'

export interface QuizCandidatePlan {
  candidateId: string
  intent: string
  assessmentIntent: string
  cognitiveIntent: QuizCognitiveIntent
  assessmentSemanticIdentity: string
  recentKnowledgeTargetsToAvoid?: string[]
  transformationVariant: string
  questionType: QuizQuestionType
  difficulty: QuizDifficulty
  sourceUnitIds: string[]
  sourceRelationIds: string[]
  sourceMaterialId: string
  sourcePage: number
  unitKind: KnowledgeUnitKind
  evidence: SourceEvidence[]
  evidenceLinks: EvidenceLink[]
  answerTarget: AnswerTarget
  groundingTarget: GroundingTarget
}

export interface PlannedQuizQuestion {
  id: string
  slotId: string
  candidateId: string
  order: number
  intent: string
  assessmentIntent: string
  cognitiveIntent: QuizCognitiveIntent
  assessmentSemanticIdentity: string
  recentKnowledgeTargetsToAvoid?: string[]
  transformationVariant: string
  questionType: QuizQuestionType
  difficulty: QuizDifficulty
  sourceUnitIds: string[]
  sourceRelationIds: string[]
  sourceMaterialId: string
  sourcePage: number
  unitKind: KnowledgeUnitKind
  evidence: SourceEvidence[]
  evidenceLinks: EvidenceLink[]
  answerTarget: AnswerTarget
  groundingTarget: GroundingTarget
}

export interface QuizPlan {
  brainFingerprint: string
  config: QuizConfig
  configFingerprint: string
  plannedQuestions: PlannedQuizQuestion[]
  slots: QuizPlanSlot[]
  candidatePoolBySlot: Record<string, QuizCandidatePlan[]>
  globalCandidatePool: QuizCandidatePlan[]
  typeCapabilityDiagnostics: Partial<Record<QuizQuestionType, { capacity: number; reason?: string }>>
  /** Fixed, persistence-free novelty inputs reused by recovery for this generation. */
  noveltyContext?: {
    generationId: string
    historyCounts: Record<string, number>
    assessmentHistoryCounts: Record<string, number>
  }
}

export interface QuizCoverageAnalysis {
  recommendedQuestionCount: number
  suggestedQuestionCount: number
  totalAssessableTargets: number
  coveredTargetCount: number
  estimatedCoveragePercent: number
  fullCoverageAchievableInSingleQuiz: boolean
  maxSingleQuizCoveragePercent: number
  representedSupportedTypeCount: number
  supportedSelectedTypeCount: number
  groundedAssertionsConsidered: number
  assessablePageCount: number
  sourceRegionCount: number
  knowledgeCoverageMinimum: number
  sourceRegionCoverageMinimum: number
  supportedTypeMinimum: number
  supportedSelectedTypes: QuizQuestionType[]
  unsupportedSelectedTypes: Array<{ type: QuizQuestionType; reason?: string }>
}

export interface QuizQuestionGrounding {
  planId: string
  slotId?: string
  candidateId?: string
  assessmentIntent?: string
  assessmentSemanticIdentity?: string
  sourceUnitIds: string[]
  sourceRelationIds: string[]
  evidence: SourceEvidence[]
  evidenceLinks?: EvidenceLink[]
  answerTarget?: AnswerTarget
  groundingTarget?: GroundingTarget
  supportingText: string
}

export interface QuizGenerationHistoryEntry {
  generationId: string
  /** One canonical, sorted unit+relation identity per accepted question. */
  knowledgeTargetIds: string[]
  /** Parallel to knowledgeTargetIds; empty when a legacy question has no intent. */
  assessmentIntents: string[]
  /** Parallel semantic evaluation identities; absent in legacy history. */
  assessmentSemanticIdentities?: string[]
  generatedAt: string
}

export interface QuizGenerationHistoryRecord {
  /** Oldest first; the most recent generation is the final entry. */
  entries: QuizGenerationHistoryEntry[]
}

export type GroundedQuizQuestion = QuizQuestion & {
  grounding: QuizQuestionGrounding
}

export type TrueFalseValueClass =
  | 'boolean_true' | 'boolean_false' | 'string_true' | 'string_false'
  | 'spanish_true' | 'spanish_false' | 'numeric_zero' | 'numeric_one'
  | 'nullish' | 'other'

export type SupportCheckMode = 'exact' | 'normalized' | 'none'

export type QuizRejectionReason =
  | 'unknown_plan' | 'invalid_schema' | 'missing_unit' | 'missing_relation'
  | 'invalid_evidence' | 'source_leakage' | 'unsupported_answer' | 'duplicate'

export type QuizRejectionSubReason =
  | 'supporting_text_missing' | 'supporting_text_not_found'
  | 'correct_option_not_supported' | 'correct_answer_index_invalid'
  | 'duplicate_id' | 'duplicate_question' | 'duplicate_intent'
  | 'duplicate_assessment_identity'

export interface QuizRejectionDiagnostic {
  planId: string
  slotId?: string
  candidateId?: string
  questionType: QuizQuestionType
  unitKind: KnowledgeUnitKind
  reason: QuizRejectionReason
  subReason?: QuizRejectionSubReason
  schemaMismatchField?: string
  rawCorrectAnswerType?: string
  correctAnswerValueClass?: TrueFalseValueClass
  optionCount?: number
  correctAnswerIndexValid?: boolean
  supportingTextPresent?: boolean
  supportingTextMatched?: boolean
  correctOptionSupported?: boolean
  supportCheckMode?: SupportCheckMode
  duplicateAgainstPlanId?: string
}

export type QuizGenerationTerminalStatus =
  | 'ready'
  | 'insufficient_valid_questions'
  | 'recovery_budget_exhausted'
  | 'provider_generation_failed'

export interface QuizGenerationTelemetry {
  requestedQuestionCount: number
  initialGenerated: number
  initialAccepted: number
  replacementAttempts: number
  replacementBatches: number
  providerAttemptsTotal: number
  providerAttemptsBudget: number
  finalAccepted: number
  requestedTypeCounts: Partial<Record<QuizQuestionType, number>>
  plannedTypeCounts: Partial<Record<QuizQuestionType, number>>
  acceptedTypeCounts: Partial<Record<QuizQuestionType, number>>
  availableCapacityByType: Partial<Record<QuizQuestionType, number>>
  unsupportedSelectedTypes: QuizQuestionType[]
  distinctKnowledgeTargets: number
  averageGroundingComplexityByDifficulty: Partial<Record<QuizDifficulty, number>>
  correctPositionCounts: Partial<Record<string, number>>
  rejections: QuizRejectionDiagnostic[]
  failureReason?: string
}

export interface QuizArtifact {
  scope: BrainScope
  meta: {
    schemaVersion: string
    quizVersion: string
    plannerVersion: string
    generatorVersion: string
    presentationVersion: string
    authoritativeSessionId: string
    brainFingerprint: string
    configFingerprint: string
    sourceSelectionFingerprint: string
    generatedAt: string
    status: 'ready' | 'generating'
    llmCallsUsed: number
    generationId?: string
    generation?: QuizGenerationTelemetry
  }
  config: QuizConfig
  questions: GroundedQuizQuestion[]
}

export type QuizSlotStatus = 'pending' | 'generating' | 'ready' | 'retryable_failed' | 'terminal_failed'

export interface QuizGenerationManifest {
  schemaVersion: string
  identity: string
  sessionId: string
  brainFingerprint: string
  configFingerprint: string
  generationId: string
  status: 'planning' | 'generating' | 'ready' | 'failed'
  config: QuizConfig
  frozenPlan: QuizPlan
  totalSlots: number
  presentedOrder: string[]
  slots: Record<string, {
    order: number
    status: QuizSlotStatus
    questionId?: string
    attempts: number
  }>
  retiredCandidateIds: string[]
  providerAttemptsBudget: number
  providerAttemptsUsed: number
  generationProgress: {
    initialGenerated: number
    initialAccepted: number
    replacementAttempts: number
    replacementBatches: number
    rejections: QuizRejectionDiagnostic[]
  }
  failureReason?: string
  createdAt: string
  updatedAt: string
}

export interface QuizArtifactStore {
  get(identity: string): Promise<QuizArtifact | null>
  save(identity: string, artifact: QuizArtifact): Promise<void>
  getHistory?(identity: string): Promise<QuizGenerationHistoryRecord | null>
  saveHistory?(identity: string, history: QuizGenerationHistoryRecord): Promise<void>
  getManifest?(identity: string): Promise<QuizGenerationManifest | null>
  saveManifest?(identity: string, manifest: QuizGenerationManifest): Promise<void>
}

export type QuizV2ErrorCode =
  | 'UNAUTHORIZED' | 'SESSION_NOT_FOUND' | 'SOURCE_SELECTION_MISMATCH'
  | 'BRAIN_NOT_READY' | 'BRAIN_PARTIAL' | 'STALE_BRAIN' | 'INVALID_CONFIG'
  | 'GENERATION_FAILED' | 'RECOVERY_BUDGET_EXHAUSTED'
  | 'INSUFFICIENT_VALID_QUESTIONS' | 'INSUFFICIENT_KNOWLEDGE' | 'ARTIFACT_CORRUPT' | 'ARTIFACT_MISS'

export type QuizArtifactResult = {
  status: 'ready'
  cacheStatus: 'hit' | 'miss' | 'shared_inflight'
  artifact: QuizArtifact
}

export type QuizProgressiveResult = {
  status: 'generating' | 'ready' | 'failed'
  cacheStatus: 'hit' | 'miss' | 'shared_inflight'
  artifact: QuizArtifact
  manifest: QuizGenerationManifest
}
