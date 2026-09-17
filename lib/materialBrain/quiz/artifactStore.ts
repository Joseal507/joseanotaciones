import { createHash, randomUUID } from 'node:crypto'
import { getMaterialResult, saveMaterialResult } from '../../materials/repository'
import { sourceEvidenceId, validateSourceEvidence } from '../../materials/sourceEvidence'
import type { QuizQuestionType } from '../../types/quiz'
import type { KnowledgeUnit, MaterialBrain } from '../types'
import { generateQuizChunk, generateQuizFromPlan, type GenerateQuizBatchFn } from './generator'
import { planQuiz, quizConfigFingerprint, quizKnowledgeTargetId, normalizeQuizConfig } from './planner'
import { applyPresentationToOne, applyQuizPresentation, computeMcTargetAssignment, computePresentedSlotOrder } from './presentation'
import {
  normalizeGroundingText, resolveAuthoritativeEvidenceForLink, verifyEvidenceLink,
} from './grounding'
import { persistedQuestionSupported, persistedTargetQuestionSupported, verifyTrueFalseAnswerTarget } from './validate'
import { normalizeQuizText, type QuizValidationContext } from './validate'
import {
  QUIZ_GENERATOR_VERSION, QUIZ_PLANNER_VERSION, QUIZ_PRESENTATION_VERSION,
  QUIZ_SCHEMA_VERSION,
  QUIZ_MANIFEST_VERSION,
  QUIZ_DEFAULT_BATCH_SIZE,
  computeQuizProviderBudget,
  type AnswerTarget,
  type GroundedQuizQuestion,
  type QuizArtifact, type QuizArtifactResult, type QuizArtifactStore, type QuizConfig, type QuizDifficulty,
  type QuizGenerationTelemetry, type QuizRejectionDiagnostic,
  type QuizGenerationHistoryRecord,
  type QuizGenerationManifest, type QuizProgressiveResult,
} from './types'

const QUIZ_ENFOQUE = 'mixto' as const
const QUIZ_RESULT_TYPE = 'quiz' as const
const QUIZ_HISTORY_RESULT_TYPE = 'quiz_history' as const
const QUIZ_MANIFEST_RESULT_TYPE = 'quiz_manifest' as const
const QUIZ_HISTORY_LIMIT = 5
const inFlight = new Map<string, Promise<QuizArtifactResult>>()
const progressiveInFlight = new Map<string, Promise<QuizProgressiveResult>>()
const QUIZ_INITIAL_PROGRESSIVE_BATCH_SIZE = 5

export function quizArtifactIdentity(sessionId: string, brainFingerprint: string, configFingerprint: string, generationId?: string): string
export function quizArtifactIdentity(brainFingerprint: string, configFingerprint: string): string
export function quizArtifactIdentity(first: string, second: string, third?: string, fourth?: string): string {
  const sessionId = third === undefined ? 'quiz-test-session' : first
  const brainFingerprint = third === undefined ? first : second
  const configFingerprint = third === undefined ? second : third
  const generationId = fourth
  return createHash('sha256').update(JSON.stringify({
    authoritativeSessionId: sessionId, brainFingerprint,
    sourceSelectionFingerprint: brainFingerprint, configFingerprint,
    schemaVersion: QUIZ_SCHEMA_VERSION,
    plannerVersion: QUIZ_PLANNER_VERSION,
    generatorVersion: QUIZ_GENERATOR_VERSION,
    presentationVersion: QUIZ_PRESENTATION_VERSION,
    ...(generationId ? { generationId } : {}),
  })).digest('hex')
}

function materialId(identity: string) { return `quiz_set:${identity}` }

export function quizGenerationHistoryIdentity(
  sessionId: string, brainFingerprint: string, configFingerprint: string,
): string {
  return createHash('sha256').update(JSON.stringify({
    authoritativeSessionId: sessionId,
    brainFingerprint,
    sourceSelectionFingerprint: brainFingerprint,
    configFingerprint,
    kind: 'quiz_generation_history',
  })).digest('hex')
}

function historyMaterialId(identity: string) { return `quiz_history:${identity}` }
function manifestMaterialId(identity: string) { return `quiz_manifest:${identity}` }

function decodeHistory(payload: unknown): QuizGenerationHistoryRecord | null {
  if (!isRecord(payload) || !Array.isArray(payload.entries)) return null
  const entries = payload.entries.filter(entry => isRecord(entry)
    && typeof entry.generationId === 'string'
    && typeof entry.generatedAt === 'string'
    && Array.isArray(entry.knowledgeTargetIds)
    && entry.knowledgeTargetIds.every(id => typeof id === 'string' && id.length > 0)
    && Array.isArray(entry.assessmentIntents)
    && entry.assessmentIntents.every(intent => typeof intent === 'string')
    && entry.assessmentIntents.length === entry.knowledgeTargetIds.length
    && (entry.assessmentSemanticIdentities === undefined
      || (Array.isArray(entry.assessmentSemanticIdentities)
        && entry.assessmentSemanticIdentities.every(identity => typeof identity === 'string')
        && entry.assessmentSemanticIdentities.length === entry.knowledgeTargetIds.length)))
    .slice(-QUIZ_HISTORY_LIMIT) as QuizGenerationHistoryRecord['entries']
  return { entries }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

function isAnswerTarget(value: unknown): value is AnswerTarget {
  if (!isRecord(value) || !['single_text', 'multi_text', 'pairs', 'boolean'].includes(String(value.kind))) return false
  return Array.isArray(value.assertionIds) && value.assertionIds.length > 0
    && value.assertionIds.every(id => typeof id === 'string' && id.length > 0)
}

export type PersistedArtifactValidation =
  | { ok: true; artifact: QuizArtifact }
  | { ok: false; classification: 'stale' | 'corrupt'; reason: string }

function decodeQuestion(q: any, allowedTypes: Set<QuizQuestionType>, seenIds: Set<string>): string | null {
  if (!isRecord(q)) return 'not_object'
  if (typeof q.id !== 'string' || !q.id.trim()) return 'id_missing'
  if (seenIds.has(q.id)) return 'duplicate_id'
  seenIds.add(q.id)
  if (typeof q.type !== 'string' || !allowedTypes.has(q.type as QuizQuestionType)) return 'type_not_allowed'
  if (typeof q.question !== 'string' || q.question.trim().length < 4) return 'question_missing'
  const grounding = (q as any).grounding
  if (!isRecord(grounding)) return 'grounding_missing'
  if (typeof grounding.planId !== 'string' || !grounding.planId.startsWith('quiz-plan:')) return 'grounding_planId_invalid'
  if (!Array.isArray(grounding.sourceUnitIds) || grounding.sourceUnitIds.length < 1
    || grounding.sourceUnitIds.some((id: unknown) => typeof id !== 'string' || !id)) return 'grounding_units_missing'
  if (!Array.isArray(grounding.sourceRelationIds)
    || grounding.sourceRelationIds.some((id: unknown) => typeof id !== 'string' || !id)) return 'grounding_relations_invalid'
  if (!Array.isArray(grounding.evidence) || grounding.evidence.length < 1) return 'grounding_evidence_missing'
  if (!grounding.evidence.every(validateSourceEvidence)) return 'grounding_evidence_invalid'
  if (!Array.isArray(grounding.evidenceLinks) || grounding.evidenceLinks.length < 1) return 'grounding_links_missing'

  switch (q.type) {
    case 'multiple_choice': {
      if (!Array.isArray(q.options) || q.options.length !== 4) return 'mc_options_invalid'
      if (q.options.some((o: any) => typeof o !== 'string' || !o.trim())) return 'mc_option_empty'
      if (new Set((q.options as string[]).map(o => o.trim().toLowerCase())).size !== 4) return 'mc_options_duplicate'
      if (!Number.isInteger(q.correctAnswer) || (q.correctAnswer as number) < 0 || (q.correctAnswer as number) > 3) return 'mc_correct_index_invalid'
      break
    }
    case 'multi_select': {
      if (!Array.isArray(q.options) || q.options.length < 3 || q.options.length > 5) return 'ms_options_invalid'
      if (!Array.isArray(q.correctAnswers) || q.correctAnswers.length < 2) return 'ms_correct_invalid'
      const opts = q.options as any[]
      if (opts.some(option => typeof option !== 'string' || !option.trim())
        || new Set(opts.map(normalizeGroundingText)).size !== opts.length) return 'ms_options_duplicate'
      if (!q.correctAnswers.every((i: any) => Number.isInteger(i) && i >= 0 && i < opts.length)) return 'ms_correct_index_invalid'
      if (new Set(q.correctAnswers).size !== q.correctAnswers.length) return 'ms_correct_duplicate'
      break
    }
    case 'true_false': {
      if (typeof q.correctAnswer !== 'boolean') return 'tf_correct_invalid'
      break
    }
    case 'fill_blank': {
      if (typeof q.answer !== 'string' || !q.answer.trim()) return 'fb_answer_missing'
      if (typeof q.question !== 'string' || !q.question.includes('___')) return 'fb_placeholder_missing'
      if (!Array.isArray(q.wordBank) || q.wordBank.length < 4
        || q.wordBank.some((word: unknown) => typeof word !== 'string' || !word.trim())
        || !q.wordBank.some((word: string) => normalizeGroundingText(word) === normalizeGroundingText(q.answer))) return 'fb_wordbank_invalid'
      break
    }
    case 'matching': {
      if (!Array.isArray(q.pairs) || q.pairs.length < 2 || q.pairs.length > 4) return 'match_pairs_invalid'
      if (!q.pairs.every((p: any) => isRecord(p) && typeof p.left === 'string' && p.left.trim()
        && typeof p.right === 'string' && p.right.trim())) return 'match_pair_shape_invalid'
      if (new Set(q.pairs.map((p: any) => normalizeGroundingText(p.left))).size !== q.pairs.length
        || new Set(q.pairs.map((p: any) => normalizeGroundingText(p.right))).size !== q.pairs.length) return 'match_pairs_duplicate'
      break
    }
    case 'short_answer': {
      if (!Array.isArray(q.acceptedAnswers) || q.acceptedAnswers.length < 1
        || q.acceptedAnswers.some((answer: unknown) => typeof answer !== 'string' || !answer.trim())) return 'sa_accepted_missing'
      if (new Set(q.acceptedAnswers.map(normalizeGroundingText)).size !== q.acceptedAnswers.length) return 'sa_accepted_duplicate'
      break
    }
  }
  return null
}

function decodeQuizArtifactInternal(
  payload: unknown,
  expected: {
    sessionId?: string
    brain: MaterialBrain
    config: QuizConfig
    configFingerprint: string
  },
  allowGenerating: boolean,
): PersistedArtifactValidation {
  if (!isRecord(payload)) return { ok: false, classification: 'corrupt', reason: 'payload_not_object' }
  const meta = (payload as any).meta
  const cfg = (payload as any).config
  const questions = (payload as any).questions
  if (!isRecord(meta)) return { ok: false, classification: 'corrupt', reason: 'meta_missing' }
  if (!isRecord(cfg)) return { ok: false, classification: 'corrupt', reason: 'config_missing' }
  if (!Array.isArray(questions)) return { ok: false, classification: 'corrupt', reason: 'questions_not_array' }

  const expectedSessionId = expected.sessionId || 'quiz-test-session'
  const identityMismatch =
    (!allowGenerating ? meta.status !== 'ready' : !['ready', 'generating'].includes(String(meta.status)))
    || meta.schemaVersion !== QUIZ_SCHEMA_VERSION
    || meta.quizVersion !== QUIZ_SCHEMA_VERSION
    || meta.plannerVersion !== QUIZ_PLANNER_VERSION
    || meta.generatorVersion !== QUIZ_GENERATOR_VERSION
    || meta.presentationVersion !== QUIZ_PRESENTATION_VERSION
    || meta.authoritativeSessionId !== expectedSessionId
    || meta.brainFingerprint !== expected.brain.scope.fingerprint
    || meta.sourceSelectionFingerprint !== expected.brain.scope.fingerprint
    || meta.configFingerprint !== expected.configFingerprint
  if (identityMismatch) return { ok: false, classification: 'stale', reason: 'identity_mismatch' }

  let canonicalSavedConfig: QuizConfig
  try { canonicalSavedConfig = normalizeQuizConfig(cfg) } catch {
    return { ok: false, classification: 'corrupt', reason: 'config_invalid' }
  }
  if (quizConfigFingerprint(canonicalSavedConfig) !== meta.configFingerprint) {
    return { ok: false, classification: 'corrupt', reason: 'config_fingerprint_mismatch' }
  }

  if (cfg.questionCount !== expected.config.questionCount) return { ok: false, classification: 'corrupt', reason: 'config_questionCount_mismatch' }
  if (cfg.difficulty !== expected.config.difficulty) return { ok: false, classification: 'corrupt', reason: 'config_difficulty_mismatch' }
  if ((cfg.language || '') !== (expected.config.language || '')) return { ok: false, classification: 'corrupt', reason: 'config_language_mismatch' }
  const savedTypes = Array.isArray(cfg.questionTypes) ? [...cfg.questionTypes].sort() : []
  const expectedTypes = [...expected.config.questionTypes].sort()
  if (savedTypes.length !== expectedTypes.length || savedTypes.some((t, i) => t !== expectedTypes[i])) {
    return { ok: false, classification: 'corrupt', reason: 'config_types_mismatch' }
  }

  if ((!allowGenerating || meta.status === 'ready') && questions.length !== expected.config.questionCount) {
    return { ok: false, classification: 'corrupt', reason: 'questions_count_mismatch' }
  }
  if (allowGenerating && meta.status === 'generating' && questions.length >= expected.config.questionCount) {
    return { ok: false, classification: 'corrupt', reason: 'partial_questions_count_invalid' }
  }

  const allowedTypes = new Set<QuizQuestionType>(expected.config.questionTypes)
  if (JSON.stringify((payload as any).scope) !== JSON.stringify(expected.brain.scope)) {
    return { ok: false, classification: 'corrupt', reason: 'scope_mismatch' }
  }
  const units = new Map(expected.brain.units.map(unit => [unit.id, unit]))
  const relations = new Map(expected.brain.relations.map(relation => [relation.id, relation]))
  const authorizedPages = new Map<string, Set<number>>()
  for (const item of expected.brain.scope.materials) {
    authorizedPages.set(item.materialId, new Set(item.selectedPages))
  }

  const seenIds = new Set<string>()
  const seenNormalizedQuestion = new Set<string>()
  for (const q of questions as any[]) {
    const reason = decodeQuestion(q, allowedTypes, seenIds)
    if (reason) return { ok: false, classification: 'corrupt', reason: `question:${reason}` }
    const normalizedQuestion = String(q.question).trim().toLowerCase()
    if (seenNormalizedQuestion.has(normalizedQuestion)) return { ok: false, classification: 'corrupt', reason: 'duplicate_question_text' }
    seenNormalizedQuestion.add(normalizedQuestion)
    if (q.grounding.sourceUnitIds.some((id: string) => !units.has(id))) return { ok: false, classification: 'corrupt', reason: 'grounding_unit_missing' }
    if (q.grounding.sourceRelationIds.some((id: string) => !relations.has(id))) return { ok: false, classification: 'corrupt', reason: 'grounding_relation_missing' }
    const groundingEvidenceIds = new Set(q.grounding.evidence.map(sourceEvidenceId))
    const linkedUnitIds = new Set<string>()
    const linkedRelationIds = new Set<string>()
    const authoritativeEvidenceIds = new Set<string>()
    const assertionTexts: string[] = []
    for (const link of q.grounding.evidenceLinks) {
      if (!isRecord(link) || !['unit', 'relation'].includes(String(link.kind)) || typeof link.refId !== 'string'
        || !Array.isArray(link.evidence) || link.evidence.some((ev: unknown) => !validateSourceEvidence(ev))) {
        return { ok: false, classification: 'corrupt', reason: 'evidence_link_invalid' }
      }
      if (link.evidence.some((ev: any) => !groundingEvidenceIds.has(sourceEvidenceId(ev)))) {
        return { ok: false, classification: 'corrupt', reason: 'evidence_link_membership' }
      }
      const assertions = verifyEvidenceLink(link as any, units, relations)
      if (!assertions?.length) return { ok: false, classification: 'corrupt', reason: 'evidence_link_unsupported' }
      const authoritativeEvidence = resolveAuthoritativeEvidenceForLink(link as any, units, relations)
      if (!authoritativeEvidence) return { ok: false, classification: 'corrupt', reason: 'evidence_link_authority_missing' }
      authoritativeEvidence.forEach(item => authoritativeEvidenceIds.add(sourceEvidenceId(item)))
      assertionTexts.push(...assertions.map(assertion => assertion.text))
      if (link.kind === 'unit') linkedUnitIds.add(link.refId)
      else linkedRelationIds.add(link.refId)
    }
    if (q.grounding.sourceUnitIds.some((id: string) => !linkedUnitIds.has(id))
      || q.grounding.sourceRelationIds.some((id: string) => !linkedRelationIds.has(id))) {
      return { ok: false, classification: 'corrupt', reason: 'evidence_link_reference_missing' }
    }
    if (q.grounding.evidence.some((item: any) => !authoritativeEvidenceIds.has(sourceEvidenceId(item)))) {
      return { ok: false, classification: 'corrupt', reason: 'grounding_evidence_not_authoritative' }
    }
    const answerTarget = q.grounding.answerTarget
    const groundingTarget = q.grounding.groundingTarget
    const provenAssertionIds = new Set(q.grounding.evidenceLinks.flatMap((link: any) =>
      (verifyEvidenceLink(link, units, relations) || []).map(assertion => assertion.assertionId)))
    const hasTargetPath = isAnswerTarget(answerTarget)
      && isRecord(groundingTarget) && Array.isArray(groundingTarget.evidenceBackedAssertionIds)
      && answerTarget.assertionIds.length > 0 && groundingTarget.evidenceBackedAssertionIds.length > 0
      && [...answerTarget.assertionIds, ...groundingTarget.evidenceBackedAssertionIds]
        .every(id => typeof id === 'string' && provenAssertionIds.has(id))
    const answerSupported = hasTargetPath
      ? persistedTargetQuestionSupported(q, answerTarget)
        && verifyTrueFalseAnswerTarget(expected.brain, answerTarget,
          q.grounding.sourceUnitIds.map((id: string) => units.get(id))
            .filter((unit: KnowledgeUnit | undefined): unit is KnowledgeUnit => Boolean(unit)))
      : persistedQuestionSupported(q, assertionTexts, q.grounding.supportingText)
    if (!answerSupported) {
      return { ok: false, classification: 'corrupt', reason: 'answer_not_evidence_supported' }
    }
    for (const ev of q.grounding.evidence) {
      const pages = authorizedPages.get(ev.materialId)
      if (!pages) return { ok: false, classification: 'corrupt', reason: 'unauthorized_material' }
      if (pages.size > 0 && !pages.has(ev.page)) return { ok: false, classification: 'corrupt', reason: 'unauthorized_page' }
      if (ev.derivation === 'vision' && 'quote' in ev) return { ok: false, classification: 'corrupt', reason: 'visual_evidence_has_quote' }
    }
  }

  return { ok: true, artifact: payload as unknown as QuizArtifact }
}

export function decodePersistedQuizArtifact(
  payload: unknown,
  expected: Parameters<typeof decodeQuizArtifactInternal>[1],
): PersistedArtifactValidation {
  return decodeQuizArtifactInternal(payload, expected, false)
}

export function decodePartialQuizArtifact(
  payload: unknown,
  expected: Parameters<typeof decodeQuizArtifactInternal>[1],
): PersistedArtifactValidation {
  return decodeQuizArtifactInternal(payload, expected, true)
}

export class WorkerQuizArtifactStore implements QuizArtifactStore {
  constructor(private deps: {
    getMaterialResult?: typeof getMaterialResult
    saveMaterialResult?: typeof saveMaterialResult
  } = {}) {}
  async get(identity: string): Promise<QuizArtifact | null> {
    const getResult = this.deps.getMaterialResult || getMaterialResult
    const result = await getResult(materialId(identity), QUIZ_ENFOQUE, QUIZ_RESULT_TYPE)
    if (!result) return null
    const payload = result.payload
    if (!payload || typeof payload !== 'object' || !(payload as any).meta || !Array.isArray((payload as any).questions)) {
      throw new Error('ARTIFACT_CORRUPT')
    }
    return payload as QuizArtifact
  }
  async save(identity: string, artifact: QuizArtifact): Promise<void> {
    if (artifact.meta.status === 'ready' && artifact.questions.length !== artifact.config.questionCount) throw new Error('ARTIFACT_CORRUPT')
    if (artifact.meta.status === 'generating' && artifact.questions.length >= artifact.config.questionCount) throw new Error('ARTIFACT_CORRUPT')
    const saveResult = this.deps.saveMaterialResult || saveMaterialResult
    await saveResult({
      material_id: materialId(identity), enfoque: QUIZ_ENFOQUE, result_type: QUIZ_RESULT_TYPE,
      payload: artifact, content_hash: identity,
    })
  }
  async getHistory(identity: string): Promise<QuizGenerationHistoryRecord | null> {
    const getResult = this.deps.getMaterialResult || getMaterialResult
    const result = await getResult(historyMaterialId(identity), QUIZ_ENFOQUE, QUIZ_HISTORY_RESULT_TYPE)
    return result ? decodeHistory(result.payload) : null
  }
  async saveHistory(identity: string, history: QuizGenerationHistoryRecord): Promise<void> {
    const saveResult = this.deps.saveMaterialResult || saveMaterialResult
    await saveResult({
      material_id: historyMaterialId(identity), enfoque: QUIZ_ENFOQUE, result_type: QUIZ_HISTORY_RESULT_TYPE,
      payload: { entries: history.entries.slice(-QUIZ_HISTORY_LIMIT) }, content_hash: identity,
    })
  }
  async getManifest(identity: string): Promise<QuizGenerationManifest | null> {
    const getResult = this.deps.getMaterialResult || getMaterialResult
    const result = await getResult(manifestMaterialId(identity), QUIZ_ENFOQUE, QUIZ_MANIFEST_RESULT_TYPE)
    return result?.payload && typeof result.payload === 'object' ? result.payload as QuizGenerationManifest : null
  }
  async saveManifest(identity: string, manifest: QuizGenerationManifest): Promise<void> {
    const saveResult = this.deps.saveMaterialResult || saveMaterialResult
    await saveResult({ material_id: manifestMaterialId(identity), enfoque: QUIZ_ENFOQUE,
      result_type: QUIZ_MANIFEST_RESULT_TYPE, payload: manifest, content_hash: identity })
  }
}

export class InMemoryQuizArtifactStore implements QuizArtifactStore {
  private values = new Map<string, QuizArtifact>()
  private histories = new Map<string, QuizGenerationHistoryRecord>()
  private manifests = new Map<string, QuizGenerationManifest>()
  async get(identity: string) { return this.values.get(identity) || null }
  async save(identity: string, artifact: QuizArtifact) {
    if (artifact.meta.status === 'ready' && artifact.questions.length !== artifact.config.questionCount) throw new Error('ARTIFACT_CORRUPT')
    if (artifact.meta.status === 'generating' && artifact.questions.length >= artifact.config.questionCount) throw new Error('ARTIFACT_CORRUPT')
    this.values.set(identity, JSON.parse(JSON.stringify(artifact)) as QuizArtifact)
  }
  async getHistory(identity: string) {
    const value = this.histories.get(identity)
    return value ? JSON.parse(JSON.stringify(value)) as QuizGenerationHistoryRecord : null
  }
  async saveHistory(identity: string, history: QuizGenerationHistoryRecord) {
    this.histories.set(identity, JSON.parse(JSON.stringify({ entries: history.entries.slice(-QUIZ_HISTORY_LIMIT) })))
  }
  async getManifest(identity: string) {
    const value = this.manifests.get(identity)
    return value ? JSON.parse(JSON.stringify(value)) as QuizGenerationManifest : null
  }
  async saveManifest(identity: string, manifest: QuizGenerationManifest) {
    this.manifests.set(identity, JSON.parse(JSON.stringify(manifest)) as QuizGenerationManifest)
  }
}

function safeRejection(item: QuizRejectionDiagnostic) { return { ...item } }

export function rebuildDedupeContext(questions: GroundedQuizQuestion[]): QuizValidationContext {
  const context: Required<Pick<QuizValidationContext, 'seenIds' | 'seenQuestions' | 'seenIntent' | 'seenAssessmentIdentity'>> = {
    seenIds: new Set(), seenQuestions: new Map(), seenIntent: new Map(), seenAssessmentIdentity: new Map(),
  }
  for (const question of questions) {
    const planId = question.grounding.planId
    context.seenIds.add(question.id)
    context.seenQuestions.set(normalizeQuizText(question.question), planId)
    if (question.grounding.assessmentIntent) context.seenIntent.set(question.grounding.assessmentIntent, planId)
    if (question.grounding.assessmentSemanticIdentity) {
      context.seenAssessmentIdentity.set(question.grounding.assessmentSemanticIdentity, planId)
    }
  }
  return context
}

function buildTelemetry(params: {
  requested: number
  initialGenerated: number
  initialAccepted: number
  replacementAttempts: number
  replacementBatches: number
  providerAttemptsTotal: number
  providerAttemptsBudget: number
  finalAccepted: number
  requestedTypes: QuizQuestionType[]
  plannedTypes: QuizQuestionType[]
  acceptedQuestions: GroundedQuizQuestion[]
  plan: ReturnType<typeof planQuiz>
  correctPositionCounts: Record<string, number>
  rejections: QuizRejectionDiagnostic[]
  failureReason?: string
}): QuizGenerationTelemetry {
  const requestedTypeCounts: Partial<Record<QuizQuestionType, number>> = {}
  for (const t of params.requestedTypes) requestedTypeCounts[t] = (requestedTypeCounts[t] || 0) + 1
  const plannedTypeCounts: Partial<Record<QuizQuestionType, number>> = {}
  for (const t of params.plannedTypes) plannedTypeCounts[t] = (plannedTypeCounts[t] || 0) + 1
  const acceptedTypeCounts: Partial<Record<QuizQuestionType, number>> = {}
  for (const q of params.acceptedQuestions) acceptedTypeCounts[q.type] = (acceptedTypeCounts[q.type] || 0) + 1
  const availableCapacityByType: Partial<Record<QuizQuestionType, number>> = {}
  for (const type of params.requestedTypes) {
    availableCapacityByType[type] = params.plan.typeCapabilityDiagnostics[type]?.capacity || 0
  }
  const unsupportedSelectedTypes = params.requestedTypes.filter(type => (availableCapacityByType[type] || 0) === 0)
  const distinctKnowledgeTargets = new Set(params.plan.plannedQuestions.flatMap(question => question.sourceUnitIds)).size
  const complexityTotals = new Map<QuizDifficulty, { total: number; count: number }>()
  for (const question of params.acceptedQuestions) {
    const difficulty = question.difficulty as QuizDifficulty
    const current = complexityTotals.get(difficulty) || { total: 0, count: 0 }
    current.total += question.grounding.sourceUnitIds.length + question.grounding.sourceRelationIds.length
    current.count += 1
    complexityTotals.set(difficulty, current)
  }
  const averageGroundingComplexityByDifficulty: Partial<Record<QuizDifficulty, number>> = {}
  for (const [difficulty, value] of complexityTotals) {
    averageGroundingComplexityByDifficulty[difficulty] = value.total / value.count
  }
  return {
    requestedQuestionCount: params.requested,
    initialGenerated: params.initialGenerated,
    initialAccepted: params.initialAccepted,
    replacementAttempts: params.replacementAttempts,
    replacementBatches: params.replacementBatches,
    providerAttemptsTotal: params.providerAttemptsTotal,
    providerAttemptsBudget: params.providerAttemptsBudget,
    finalAccepted: params.finalAccepted,
    requestedTypeCounts, plannedTypeCounts, acceptedTypeCounts,
    availableCapacityByType, unsupportedSelectedTypes, distinctKnowledgeTargets,
    averageGroundingComplexityByDifficulty,
    correctPositionCounts: params.correctPositionCounts,
    rejections: params.rejections.map(safeRejection),
    ...(params.failureReason ? { failureReason: params.failureReason } : {}),
  }
}

type QuizArtifactLookupOptions = { mode?: 'resume' | 'new'; generationId?: string }
export async function lookupQuizArtifact(sessionId: string, brain: MaterialBrain, config: QuizConfig, store: QuizArtifactStore, options?: QuizArtifactLookupOptions): Promise<QuizArtifact | null>
export async function lookupQuizArtifact(brain: MaterialBrain, config: QuizConfig, store: QuizArtifactStore, options?: QuizArtifactLookupOptions): Promise<QuizArtifact | null>
export async function lookupQuizArtifact(
  first: string | MaterialBrain, second: MaterialBrain | QuizConfig, third: QuizConfig | QuizArtifactStore,
  fourth?: QuizArtifactStore | QuizArtifactLookupOptions, fifth: QuizArtifactLookupOptions = {},
): Promise<QuizArtifact | null> {
  const sessionId = typeof first === 'string' ? first : 'quiz-test-session'
  const brain = (typeof first === 'string' ? second : first) as MaterialBrain
  const config = (typeof first === 'string' ? third : second) as QuizConfig
  const store = (typeof first === 'string' ? fourth : third) as QuizArtifactStore
  const options = (typeof first === 'string' ? fifth : fourth || {}) as QuizArtifactLookupOptions
  const normalized = planQuiz(brain, config)
  const generationId = options.mode === 'new' ? randomUUID() : options.generationId
  const identity = quizArtifactIdentity(sessionId, brain.scope.fingerprint, normalized.configFingerprint, generationId)
  const cached = await store.get(identity)
  if (!cached) return null
  const validation = decodePersistedQuizArtifact(cached, { sessionId, brain, config, configFingerprint: normalized.configFingerprint })
  if (validation.ok) return validation.artifact
  if (validation.ok === false && validation.classification === 'stale') return null
  throw new Error('ARTIFACT_CORRUPT')
}

export type QuizBuildOptions = QuizArtifactLookupOptions & {
  generateBatch?: GenerateQuizBatchFn; batchSize?: number; providerBudget?: number; debugCorrelationId?: string
  allocationSeed?: string
}
export async function getOrBuildQuizArtifact(sessionId: string, brain: MaterialBrain, config: QuizConfig, store: QuizArtifactStore, options?: QuizBuildOptions): Promise<QuizArtifactResult>
export async function getOrBuildQuizArtifact(brain: MaterialBrain, config: QuizConfig, store: QuizArtifactStore, options?: QuizBuildOptions): Promise<QuizArtifactResult>
export async function getOrBuildQuizArtifact(
  first: string | MaterialBrain, second: MaterialBrain | QuizConfig, third: QuizConfig | QuizArtifactStore,
  fourth?: QuizArtifactStore | QuizBuildOptions, fifth: QuizBuildOptions = {},
): Promise<QuizArtifactResult> {
  const sessionId = typeof first === 'string' ? first : 'quiz-test-session'
  const brain = (typeof first === 'string' ? second : first) as MaterialBrain
  const config = (typeof first === 'string' ? third : second) as QuizConfig
  const store = (typeof first === 'string' ? fourth : third) as QuizArtifactStore
  const options = (typeof first === 'string' ? fifth : fourth || {}) as QuizBuildOptions
  const generationId = options.mode === 'new' ? randomUUID() : options.generationId
  // Fingerprint-only planning remains history-free, including every resume hot path.
  const basePlan = planQuiz(brain, config)
  const identity = quizArtifactIdentity(sessionId, brain.scope.fingerprint, basePlan.configFingerprint, generationId)
  const cached = await store.get(identity)
  if (cached) {
    const validation = decodePersistedQuizArtifact(cached, {
      sessionId, brain, config, configFingerprint: basePlan.configFingerprint,
    })
    if (validation.ok) return { status: 'ready', cacheStatus: 'hit', artifact: validation.artifact }
    if (validation.ok === false && validation.classification === 'corrupt') throw new Error('ARTIFACT_CORRUPT')
  }
  const shared = inFlight.get(identity)
  if (shared) {
    const result = await shared
    return { ...result, cacheStatus: 'shared_inflight' }
  }
  const task = (async (): Promise<QuizArtifactResult> => {
    let history: QuizGenerationHistoryRecord | undefined
    const historyIdentity = quizGenerationHistoryIdentity(sessionId, brain.scope.fingerprint, basePlan.configFingerprint)
    if (options.mode === 'new' && generationId && store.getHistory) {
      try { history = (await store.getHistory(historyIdentity)) || undefined } catch (error) {
        console.warn('[Quiz V2]', JSON.stringify({ event: 'generation_history_read_failed', error: String(error) }))
      }
    }
    if (options.mode === 'new' && generationId) {
      console.log('[Quiz V2][config-handoff]', JSON.stringify({ stage: 'artifact_store_pre_plan', correlationId: options.debugCorrelationId || 'no-correlation-id', questionTypes: config.questionTypes, difficulty: config.difficulty, questionCount: config.questionCount, generationId }))
    }
    const plan = options.mode === 'new' && generationId
      ? planQuiz(brain, config, { generationId, history, allocationSeed: options.allocationSeed })
      : basePlan
    const generated = await generateQuizFromPlan(brain, plan, options)
    if (generated.status !== 'ready') {
      const telemetry = buildTelemetry({
        requested: config.questionCount,
        initialGenerated: generated.initialGenerated,
        initialAccepted: generated.initialAccepted,
        replacementAttempts: generated.replacementAttempts,
        replacementBatches: generated.replacementBatches,
        providerAttemptsTotal: generated.providerAttemptsTotal,
        providerAttemptsBudget: generated.providerAttemptsBudget,
        finalAccepted: generated.questions.length,
        requestedTypes: [...config.questionTypes],
        plannedTypes: plan.plannedQuestions.map(p => p.questionType),
        acceptedQuestions: generated.questions,
        plan,
        correctPositionCounts: {},
        rejections: generated.diagnostics,
        failureReason: generated.status,
      })
      console.warn('[Quiz V2]', JSON.stringify({ event: `generation_${generated.status}`, ...telemetry }))
      if (generated.status === 'insufficient_valid_questions') throw new Error('INSUFFICIENT_VALID_QUESTIONS')
      if (generated.status === 'recovery_budget_exhausted') {
        throw new Error(`RECOVERY_BUDGET_EXHAUSTED:${generated.errors.slice(0, 5).join(',')}`)
      }
      throw new Error(`GENERATION_FAILED:${generated.providerError || 'provider_error'}`)
    }

    const presentation = applyQuizPresentation(generated.questions, {
      brainFingerprint: brain.scope.fingerprint,
      configFingerprint: plan.configFingerprint,
      ...(generationId ? { generationId } : {}),
    }, config)

    const telemetry = buildTelemetry({
      requested: config.questionCount,
      initialGenerated: generated.initialGenerated,
      initialAccepted: generated.initialAccepted,
      replacementAttempts: generated.replacementAttempts,
      replacementBatches: generated.replacementBatches,
      providerAttemptsTotal: generated.providerAttemptsTotal,
      providerAttemptsBudget: generated.providerAttemptsBudget,
      finalAccepted: presentation.questions.length,
      requestedTypes: [...config.questionTypes],
      plannedTypes: plan.plannedQuestions.map(p => p.questionType),
      acceptedQuestions: presentation.questions,
      plan,
      correctPositionCounts: presentation.correctPositionCounts,
      rejections: generated.diagnostics,
    })
    console.info('[Quiz V2]', JSON.stringify({ event: 'generation_ready', ...telemetry }))

    const artifact: QuizArtifact = {
      scope: brain.scope,
      meta: {
        schemaVersion: QUIZ_SCHEMA_VERSION,
        quizVersion: QUIZ_SCHEMA_VERSION,
        plannerVersion: QUIZ_PLANNER_VERSION,
        generatorVersion: QUIZ_GENERATOR_VERSION,
        presentationVersion: QUIZ_PRESENTATION_VERSION,
        authoritativeSessionId: sessionId,
        brainFingerprint: brain.scope.fingerprint,
        configFingerprint: plan.configFingerprint,
        sourceSelectionFingerprint: brain.scope.fingerprint,
        generatedAt: new Date().toISOString(),
        status: 'ready',
        llmCallsUsed: generated.llmCallsUsed,
        ...(generationId ? { generationId } : {}),
        generation: telemetry,
      },
      config: plan.config,
      questions: presentation.questions,
    }
    await store.save(identity, artifact)
    if (options.mode === 'new' && generationId && store.saveHistory) {
      try {
        let latest = history || { entries: [] }
        if (store.getHistory) {
          try { latest = (await store.getHistory(historyIdentity)) || latest } catch (error) {
            console.warn('[Quiz V2]', JSON.stringify({ event: 'generation_history_reread_failed', error: String(error) }))
          }
        }
        const entry = {
          generationId,
          knowledgeTargetIds: artifact.questions.map(question => quizKnowledgeTargetId(
            question.grounding.sourceUnitIds, question.grounding.sourceRelationIds,
          )),
          assessmentIntents: artifact.questions.map(question => question.grounding.assessmentIntent || ''),
          assessmentSemanticIdentities: artifact.questions.map(question =>
            question.grounding.assessmentSemanticIdentity || ''),
          generatedAt: artifact.meta.generatedAt,
        }
        await store.saveHistory(historyIdentity, { entries: [...latest.entries, entry].slice(-QUIZ_HISTORY_LIMIT) })
      } catch (error) {
        console.warn('[Quiz V2]', JSON.stringify({ event: 'generation_history_write_failed', error: String(error) }))
      }
    }
    return { status: 'ready', cacheStatus: 'miss', artifact }
  })()
  inFlight.set(identity, task)
  try { return await task } finally { if (inFlight.get(identity) === task) inFlight.delete(identity) }
}

function progressiveIdentity(manifest: QuizGenerationManifest) {
  return { brainFingerprint: manifest.brainFingerprint, configFingerprint: manifest.configFingerprint,
    generationId: manifest.generationId }
}

function manifestSummaryReadyCount(manifest: QuizGenerationManifest): number {
  return Object.values(manifest.slots).filter(slot => slot.status === 'ready').length
}

async function persistProgressiveMerge(
  identity: string,
  store: QuizArtifactStore,
  manifest: QuizGenerationManifest,
  artifact: QuizArtifact,
): Promise<{ manifest: QuizGenerationManifest; artifact: QuizArtifact }> {
  const latestManifest = await store.getManifest?.(identity)
  const latestArtifact = await store.get(identity)
  const readyBySlot = new Map<string, GroundedQuizQuestion>()
  for (const question of [...(latestArtifact?.questions || []), ...artifact.questions]) {
    const slotId = question.grounding.slotId
    if (slotId && !readyBySlot.has(slotId)) readyBySlot.set(slotId, question)
  }
  const mergedManifest: QuizGenerationManifest = latestManifest ? {
    ...manifest,
    createdAt: latestManifest.createdAt,
    slots: Object.fromEntries(Object.keys(manifest.slots).map(slotId => {
      const latest = latestManifest.slots[slotId]
      const incoming = manifest.slots[slotId]
      return [slotId, latest?.status === 'ready' ? latest : incoming]
    })),
    retiredCandidateIds: [...new Set([...(latestManifest.retiredCandidateIds || []), ...manifest.retiredCandidateIds])],
    providerAttemptsUsed: Math.max(latestManifest.providerAttemptsUsed, manifest.providerAttemptsUsed),
    generationProgress: manifest.generationProgress || latestManifest.generationProgress || {
      initialGenerated: 0, initialAccepted: 0, replacementAttempts: 0, replacementBatches: 0, rejections: [],
    },
    updatedAt: new Date().toISOString(),
  } : manifest
  const orderedQuestions = mergedManifest.presentedOrder.flatMap(slotId => {
    const question = readyBySlot.get(slotId)
    return question ? [question] : []
  })
  const complete = orderedQuestions.length === mergedManifest.totalSlots
    && Object.values(mergedManifest.slots).every(slot => slot.status === 'ready')
  mergedManifest.status = complete ? 'ready' : mergedManifest.status === 'failed' ? 'failed' : 'generating'
  const mergedArtifact: QuizArtifact = {
    ...artifact,
    meta: { ...artifact.meta, status: complete ? 'ready' : 'generating' },
    questions: orderedQuestions,
  }
  await store.save(identity, mergedArtifact)
  await store.saveManifest?.(identity, mergedManifest)
  return { manifest: mergedManifest, artifact: mergedArtifact }
}

async function writeProgressiveHistory(
  sessionId: string, brain: MaterialBrain, manifest: QuizGenerationManifest,
  artifact: QuizArtifact, store: QuizArtifactStore,
) {
  if (!store.saveHistory) return
  const historyIdentity = quizGenerationHistoryIdentity(sessionId, brain.scope.fingerprint, manifest.configFingerprint)
  let latest = store.getHistory ? (await store.getHistory(historyIdentity)) || { entries: [] } : { entries: [] }
  const entry = {
    generationId: manifest.generationId,
    knowledgeTargetIds: artifact.questions.map(q => quizKnowledgeTargetId(q.grounding.sourceUnitIds, q.grounding.sourceRelationIds)),
    assessmentIntents: artifact.questions.map(q => q.grounding.assessmentIntent || ''),
    assessmentSemanticIdentities: artifact.questions.map(q => q.grounding.assessmentSemanticIdentity || ''),
    generatedAt: artifact.meta.generatedAt,
  }
  latest = { entries: [...latest.entries.filter(item => item.generationId !== manifest.generationId), entry].slice(-QUIZ_HISTORY_LIMIT) }
  await store.saveHistory(historyIdentity, latest)
}

async function runProgressiveChunk(
  sessionId: string, brain: MaterialBrain, store: QuizArtifactStore,
  manifest: QuizGenerationManifest, artifact: QuizArtifact, targetSlotIds: string[], options: QuizBuildOptions,
): Promise<QuizProgressiveResult> {
  const identity = manifest.identity
  const latestManifest = (await store.getManifest?.(identity)) || manifest
  const latestArtifact = (await store.get(identity)) || artifact
  const target = targetSlotIds.filter(slotId => latestManifest.slots[slotId]
    && latestManifest.slots[slotId].status !== 'ready').slice(0, options.batchSize || QUIZ_DEFAULT_BATCH_SIZE)
  if (!target.length) return { status: latestManifest.status === 'ready' ? 'ready' : latestManifest.status === 'failed' ? 'failed' : 'generating',
    cacheStatus: 'hit', artifact: latestArtifact, manifest: latestManifest }

  const now = new Date().toISOString()
  for (const slotId of target) latestManifest.slots[slotId] = {
    ...latestManifest.slots[slotId], status: 'generating', attempts: latestManifest.slots[slotId].attempts + 1,
  }
  latestManifest.updatedAt = now
  await store.saveManifest?.(identity, latestManifest)

  const acceptedBySlot = new Map<string, GroundedQuizQuestion>()
  for (const question of latestArtifact.questions) if (question.grounding.slotId) acceptedBySlot.set(question.grounding.slotId, question)
  const attemptedCandidateIds = new Set(latestArtifact.questions.map(q => q.grounding.candidateId).filter((id): id is string => Boolean(id)))
  const remainingBudget = latestManifest.providerAttemptsBudget - latestManifest.providerAttemptsUsed
  const result = await generateQuizChunk(brain, latestManifest.frozenPlan, {
    acceptedBySlot, attemptedCandidateIds,
    globallyRetiredCandidateIds: new Set(latestManifest.retiredCandidateIds),
    dedupe: rebuildDedupeContext(latestArtifact.questions), historyCounts: new Map(), assessmentHistoryCounts: new Map(),
    providerAttemptsBudgetRemaining: remainingBudget,
  }, target, options.generateBatch, options.batchSize || QUIZ_DEFAULT_BATCH_SIZE, latestManifest.config.language)

  latestManifest.providerAttemptsUsed += result.providerAttemptsUsed
  const currentProgress = latestManifest.generationProgress || {
    initialGenerated: 0, initialAccepted: 0, replacementAttempts: 0, replacementBatches: 0, rejections: [],
  }
  latestManifest.generationProgress = {
    initialGenerated: currentProgress.initialGenerated + result.initialGenerated,
    initialAccepted: currentProgress.initialAccepted + result.initialAccepted,
    replacementAttempts: currentProgress.replacementAttempts + result.replacementAttempts,
    replacementBatches: currentProgress.replacementBatches + result.replacementBatches,
    rejections: [...currentProgress.rejections, ...result.diagnostics],
  }
  latestManifest.retiredCandidateIds = [...new Set([...latestManifest.retiredCandidateIds, ...result.retiredCandidateIds])]
  const mcTargets = computeMcTargetAssignment(latestManifest.frozenPlan, progressiveIdentity(latestManifest))
  const newQuestions: GroundedQuizQuestion[] = []
  for (const slotId of target) {
    const question = result.acceptedBySlot.get(slotId)
    if (question) {
      latestManifest.slots[slotId] = { ...latestManifest.slots[slotId], status: 'ready', questionId: question.id }
      newQuestions.push(applyPresentationToOne(question, progressiveIdentity(latestManifest), mcTargets.get(slotId)))
    } else {
      const exhausted = latestManifest.providerAttemptsUsed >= latestManifest.providerAttemptsBudget
        || result.terminalStatus === 'insufficient_valid_questions'
      latestManifest.slots[slotId] = { ...latestManifest.slots[slotId], status: exhausted ? 'terminal_failed' : 'retryable_failed' }
      if (exhausted) {
        latestManifest.status = 'failed'
        latestManifest.failureReason = result.providerError || result.terminalStatus
      }
    }
  }
  latestManifest.updatedAt = new Date().toISOString()
  const merged = await persistProgressiveMerge(identity, store, latestManifest, {
    ...latestArtifact,
    meta: { ...latestArtifact.meta, llmCallsUsed: latestArtifact.meta.llmCallsUsed + result.llmCallsUsed },
    questions: [...latestArtifact.questions, ...newQuestions],
  })
  if (merged.manifest.status === 'ready') {
    const correctPositionCounts: Record<string, number> = {}
    for (const question of merged.artifact.questions) {
      if (question.type !== 'multiple_choice') continue
      const position = String(question.correctAnswer)
      correctPositionCounts[position] = (correctPositionCounts[position] || 0) + 1
    }
    merged.artifact.meta.generation = buildTelemetry({
      requested: merged.manifest.totalSlots,
      initialGenerated: merged.manifest.generationProgress.initialGenerated,
      initialAccepted: merged.manifest.generationProgress.initialAccepted,
      replacementAttempts: merged.manifest.generationProgress.replacementAttempts,
      replacementBatches: merged.manifest.generationProgress.replacementBatches,
      providerAttemptsTotal: merged.manifest.providerAttemptsUsed,
      providerAttemptsBudget: merged.manifest.providerAttemptsBudget,
      finalAccepted: merged.artifact.questions.length,
      requestedTypes: [...merged.manifest.config.questionTypes],
      plannedTypes: merged.manifest.frozenPlan.plannedQuestions.map(question => question.questionType),
      acceptedQuestions: merged.artifact.questions,
      plan: merged.manifest.frozenPlan,
      correctPositionCounts,
      rejections: merged.manifest.generationProgress.rejections,
    })
    await store.save(identity, merged.artifact)
    await writeProgressiveHistory(sessionId, brain, merged.manifest, merged.artifact, store)
  }
  return { status: merged.manifest.status === 'ready' ? 'ready' : merged.manifest.status === 'failed' ? 'failed' : 'generating',
    cacheStatus: 'miss', artifact: merged.artifact, manifest: merged.manifest }
}

export async function getOrBuildQuizGeneration(
  sessionId: string, brain: MaterialBrain, config: QuizConfig, store: QuizArtifactStore,
  options: QuizBuildOptions = {},
): Promise<QuizProgressiveResult> {
  const generationId = options.mode === 'new' ? randomUUID() : options.generationId
  if (!generationId) throw new Error('MANIFEST_MISSING')
  let history: QuizGenerationHistoryRecord | undefined
  const basePlan = planQuiz(brain, config)
  if (options.mode === 'new' && store.getHistory) {
    history = (await store.getHistory(quizGenerationHistoryIdentity(sessionId, brain.scope.fingerprint, basePlan.configFingerprint))) || undefined
  }
  const plan = planQuiz(brain, config, { generationId, history, allocationSeed: options.allocationSeed })
  const identity = quizArtifactIdentity(sessionId, brain.scope.fingerprint, plan.configFingerprint, generationId)
  const shared = progressiveInFlight.get(identity)
  if (shared) return { ...(await shared), cacheStatus: 'shared_inflight' }
  const task: Promise<QuizProgressiveResult> = (async () => {
    const existingManifest = await store.getManifest?.(identity)
    const existingArtifact = await store.get(identity)
    if (existingManifest && existingArtifact) {
      return { status: existingManifest.status === 'ready' ? 'ready' : existingManifest.status === 'failed' ? 'failed' : 'generating',
        cacheStatus: 'hit' as const, artifact: existingArtifact, manifest: existingManifest }
    }
    const createdAt = new Date().toISOString()
    const presentationIdentity = { brainFingerprint: brain.scope.fingerprint, configFingerprint: plan.configFingerprint, generationId }
    const presentedOrder = computePresentedSlotOrder(plan, presentationIdentity)
    const manifest: QuizGenerationManifest = {
      schemaVersion: QUIZ_MANIFEST_VERSION, identity, sessionId, brainFingerprint: brain.scope.fingerprint,
      configFingerprint: plan.configFingerprint, generationId, status: 'generating', config: plan.config,
      frozenPlan: plan, totalSlots: plan.slots.length, presentedOrder,
      slots: Object.fromEntries(plan.slots.map(slot => [slot.slotId, { order: presentedOrder.indexOf(slot.slotId), status: 'pending', attempts: 0 }])),
      retiredCandidateIds: [], providerAttemptsBudget: computeQuizProviderBudget(config.questionCount, options.batchSize),
      providerAttemptsUsed: 0,
      generationProgress: { initialGenerated: 0, initialAccepted: 0,
        replacementAttempts: 0, replacementBatches: 0, rejections: [] },
      createdAt, updatedAt: createdAt,
    }
    const artifact: QuizArtifact = {
      scope: brain.scope,
      meta: { schemaVersion: QUIZ_SCHEMA_VERSION, quizVersion: QUIZ_SCHEMA_VERSION,
        plannerVersion: QUIZ_PLANNER_VERSION, generatorVersion: QUIZ_GENERATOR_VERSION,
        presentationVersion: QUIZ_PRESENTATION_VERSION, authoritativeSessionId: sessionId,
        brainFingerprint: brain.scope.fingerprint, configFingerprint: plan.configFingerprint,
        sourceSelectionFingerprint: brain.scope.fingerprint, generatedAt: createdAt,
        status: 'generating', llmCallsUsed: 0, generationId },
      config: plan.config, questions: [],
    }
    await store.saveManifest?.(identity, manifest)
    await store.save(identity, artifact)
    return runProgressiveChunk(sessionId, brain, store, manifest, artifact,
      presentedOrder.slice(0, Math.min(QUIZ_INITIAL_PROGRESSIVE_BATCH_SIZE, config.questionCount)), options)
  })()
  progressiveInFlight.set(identity, task)
  try { return await task } finally { if (progressiveInFlight.get(identity) === task) progressiveInFlight.delete(identity) }
}

export async function advanceQuizGeneration(
  sessionId: string, brain: MaterialBrain, config: QuizConfig, store: QuizArtifactStore,
  options: QuizBuildOptions & { generationId: string },
): Promise<QuizProgressiveResult> {
  const basePlan = planQuiz(brain, config)
  const identity = quizArtifactIdentity(sessionId, brain.scope.fingerprint, basePlan.configFingerprint, options.generationId)
  const shared = progressiveInFlight.get(identity)
  if (shared) return { ...(await shared), cacheStatus: 'shared_inflight' }
  const task: Promise<QuizProgressiveResult> = (async () => {
    const manifest = await store.getManifest?.(identity)
    const artifact = await store.get(identity)
    if (!manifest || !artifact) throw new Error('MANIFEST_MISSING')
    if (manifest.status === 'ready' || manifest.status === 'failed') return {
      status: manifest.status, cacheStatus: 'hit' as const, artifact, manifest,
    }
    // A generating marker is a short lease. It survives a crashed serverless
    // invocation, but must not strand the generation forever.
    const leaseExpired = Date.now() - Date.parse(manifest.updatedAt) > 120_000
    if (leaseExpired) {
      for (const slotId of manifest.presentedOrder) {
        if (manifest.slots[slotId]?.status === 'generating') {
          manifest.slots[slotId] = { ...manifest.slots[slotId], status: 'retryable_failed' }
        }
      }
    }
    const pending = manifest.presentedOrder.filter(slotId => ['pending', 'retryable_failed'].includes(manifest.slots[slotId]?.status))
    return runProgressiveChunk(sessionId, brain, store, manifest, artifact, pending, options)
  })()
  progressiveInFlight.set(identity, task)
  try { return await task } finally { if (progressiveInFlight.get(identity) === task) progressiveInFlight.delete(identity) }
}

export { computeQuizProviderBudget, quizConfigFingerprint, normalizeQuizConfig }
