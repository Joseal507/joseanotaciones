import { createHash, randomUUID } from 'node:crypto'
import { generateValidatedLegacyJson } from '../../ai/legacyRouteGeneration'
import {
  compareAndSwapQuizGeneration,
  getMaterialResult,
  saveMaterialResult,
} from '../../materials/repository'
import type { SourceSelectionSnapshot } from '../../adaptive/sourceSelection'
import type { QuizQuestion, QuizQuestionType } from '../../types/quiz'
import type { QuizConfig } from './types'
import { allocateQuizTypeCounts, quizAllocationSeed, seededQuizTypeOrder } from './allocation'
import { hashToSeed, shuffleWithSeed } from './random'
import {
  canonicalizeGeneratedFillBlankPrompt,
  canonicalizePersistedFillBlankQuestion,
} from '../../quiz/fillBlankContract'
import {
  createReplacementSlot,
  type QuizAtomicSlot,
  type QuizCompletionReason,
  type QuizScopePlan,
} from './progressiveCoverage'

export const ENJOYER_QUIZ_AUTHORITY_VERSION = 'studyal-material-enjoyer-1.0.0'
export const ENJOYER_QUIZ_GENERATOR_VERSION = 'enjoyer-generative-progressive-1.3.0'
export const ENJOYER_QUIZ_SCHEMA_VERSION = '4.3.0'
export const MAX_SLOT_REPLACEMENTS = 25
const MAX_REPAIR_ATTEMPTS = 2
const MAX_GENERATION_BATCH_SIZE = 8

export interface EnjoyerQuizSourceSpan { page: number; quote: string }
export interface EnjoyerAssessmentTarget {
  id: string
  sourceItemId: string
  kind: string
  title: string
  content: string
  importance: number
  difficulty: string
  examTypes: string[]
  materialId: string
  pages: number[]
  sourceSpans: EnjoyerQuizSourceSpan[]
  topicId: string | null
  topicTitle: string | null
  sourceOrder: number
}
export interface EnjoyerAssessmentUniverse {
  fingerprint: string
  targets: EnjoyerAssessmentTarget[]
  topics: Array<{ id: string; title: string; order: number }>
  unauthorizedTargetIds?: Set<string>
}
export interface EnjoyerAssessmentDesign {
  fingerprint: string
  idealQuestionCountForFullCoverage: number
  rationale: string
  targetGroups: Array<{ id: string; targetIds: string[]; rationale: string }>
}
export interface EnjoyerQuizCoverage {
  totalAssessableTargets?: number
  coveredTargetCount?: number
  uncoveredTargetCount?: number
  estimatedCoveragePercent?: number
  mode?: 'first_pass' | 'practice'
  coveredTargetIds: string[]
  uncoveredTargetIds: string[]
  topicCoverage: Array<{ topicId: string; topicTitle: string; covered: number; total: number }>
  coveragePercent: number
  coverageStatus: 'complete' | 'partial' | 'failed'
  requestedQuestionCount: number
  idealQuestionCountForFullCoverage: number
}
export type EnjoyerGroundedQuizQuestion = QuizQuestion & {
  grounding: {
    authorityVersion: string
    sourceSelectionFingerprint: string
    assessmentTargetIds: string[]
    sourceItemIds: string[]
    evidence: Array<{ materialId: string; page: number; quote: string }>
    supportingText: string
    answerTarget: { kind: 'single_text'; assertionIds: string[]; canonicalValue: string; acceptedSurfaceForms?: string[] }
    groundingTarget: { evidenceBackedAssertionIds: string[]; sourceUnitIds: string[]; sourceRelationIds: string[] }
    planId: string
    slotId: string
    candidateId: string
  }
}
export interface EnjoyerQuizArtifact {
  meta: {
    schemaVersion: string
    authorityVersion: string
    generatorVersion: string
    authoritativeSessionId: string
    sourceSelectionFingerprint: string
    configFingerprint: string
    generationId: string
    generatedAt: string
    status: 'generating' | 'ready' | 'failed'
    llmCallsUsed: number
    repairAttempts: number
    coverageRepairAttempts: number
    questionsReplacedForCoverage: number
    finalCoveragePercent: number
    finalTopicCoverage: EnjoyerQuizCoverage['topicCoverage']
  }
  config: QuizConfig
  questions: EnjoyerGroundedQuizQuestion[]
  coverage: EnjoyerQuizCoverage
  design?: EnjoyerAssessmentDesign
  scopePlan?: QuizScopePlan
  retiredSlotIds?: string[]
  completionReason?: QuizCompletionReason
}

export interface EnjoyerQuizGenerationManifest {
  schemaVersion: string
  identity: string
  sessionId: string
  sourceSelectionFingerprint: string
  configFingerprint: string
  generationId: string
  status: 'generating' | 'ready' | 'failed'
  config: QuizConfig
  universe: EnjoyerAssessmentUniverse
  design?: EnjoyerAssessmentDesign
  scopePlan?: QuizScopePlan
  completionReason?: QuizCompletionReason
  totalSlots: number
  typePlan: QuizQuestionType[]
  readyCount: number
  presentedOrder: string[]
  providerCallsUsed: number
  missingSlotRepairAttempts: number
  coverageRepairAttempts: number
  questionsReplacedForCoverage: number
  coverage: EnjoyerQuizCoverage
  rejectionCounts: Record<string, number>
  rejectedByType: Record<string, number>
  repairAttemptsByType: Record<string, number>
  redistributedSlots: number
  /** Frozen-plan slots that exhausted bounded authoring and no longer count toward ready completion. */
  retiredSlotIds?: string[]
  leaseUntil?: string
  failureReason?: string
  createdAt: string
  updatedAt: string
}

export type EnjoyerQuizProgressiveResult = {
  status: 'generating' | 'ready' | 'failed'
  cacheStatus: 'hit' | 'miss' | 'shared_inflight'
  artifact: EnjoyerQuizArtifact
  manifest: EnjoyerQuizGenerationManifest
}
export interface EnjoyerQuizStore {
  get(identity: string): Promise<EnjoyerQuizArtifact | null>
  save(identity: string, artifact: EnjoyerQuizArtifact): Promise<void>
  getManifest(identity: string): Promise<EnjoyerQuizGenerationManifest | null>
  saveManifest(identity: string, manifest: EnjoyerQuizGenerationManifest): Promise<void>
  loadState?(identity: string): Promise<EnjoyerQuizPersistedState>
  compareAndSwapState?(identity: string, expected: QuizGenerationExpectedRevision,
    artifact: EnjoyerQuizArtifact, manifest: EnjoyerQuizGenerationManifest): Promise<QuizGenerationCasResult>
}

export interface QuizGenerationExpectedRevision {
  artifactRevision: string | null
  manifestRevision: string | null
}

export interface EnjoyerQuizPersistedState extends QuizGenerationExpectedRevision {
  artifact: EnjoyerQuizArtifact | null
  manifest: EnjoyerQuizGenerationManifest | null
}

export interface QuizGenerationCasResult {
  applied: boolean
  revision: string
}

export const MAX_QUIZ_QUESTIONS = 100

const QUIZ_TYPES: QuizQuestionType[] = [
  'multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer',
]
export function normalizeEnjoyerQuizConfig(value: unknown): QuizConfig {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const questionCount = Number(input.questionCount)
  const difficulty = String(input.difficulty || '') as QuizConfig['difficulty']
  const requested = Array.isArray(input.questionTypes) ? input.questionTypes.map(String) : []
  const questionTypes = QUIZ_TYPES.filter(type => requested.includes(type))
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > MAX_QUIZ_QUESTIONS
    || !['easy', 'medium', 'hard'].includes(difficulty) || !questionTypes.length) throw new Error('INVALID_CONFIG')
  return { questionCount, difficulty, questionTypes,
    ...(typeof input.language === 'string' && input.language.trim() ? { language: input.language.trim().slice(0, 20) } : {}) }
}

type ProviderQuestion = Record<string, unknown>
export type EnjoyerQuizProvider = (request: {
  mode: 'design' | 'generate' | 'repair'
  universe: EnjoyerAssessmentUniverse
  design?: EnjoyerAssessmentDesign
  config?: QuizConfig
  requestedCount?: number
  missingSlots?: number
  requiredSlots?: Array<{ slot: number; slotId?: string; type: QuizQuestionType; primaryTargetId?: string }>
  focusTargetIds?: string[]
  existingQuestions?: Array<{ question: string; normalizedStem: string; sourceItemIds: string[]; assessmentTargetIds: string[] }>
}) => Promise<unknown>

export function buildEnjoyerQuizTypePlan(config: QuizConfig): QuizQuestionType[] {
  const seed = quizAllocationSeed(config.questionCount, config.questionTypes, config.difficulty)
  const counts = allocateQuizTypeCounts(config.questionCount, config.questionTypes, seed)
  const order = seededQuizTypeOrder(config.questionTypes, seed)
  const plan: QuizQuestionType[] = []
  while (plan.length < config.questionCount) {
    for (const type of order) {
      if ((counts.get(type) || 0) > 0) {
        plan.push(type)
        counts.set(type, (counts.get(type) || 0) - 1)
      }
    }
  }
  return plan
}

function remainingTypePlan(typePlan: QuizQuestionType[], questions: EnjoyerGroundedQuizQuestion[]): QuizQuestionType[] {
  const ready = new Map<QuizQuestionType, number>()
  for (const question of questions) ready.set(question.type, (ready.get(question.type) || 0) + 1)
  return typePlan.filter(type => {
    const count = ready.get(type) || 0
    if (count > 0) { ready.set(type, count - 1); return false }
    return true
  })
}

type EnjoyerAuthority = {
  sourceSelectionFingerprint?: string
  globalOrderedAnalysis?: unknown[]
  uniqueConceptsIndex?: unknown[]
  topicsIndex?: unknown[]
}

function authorityFrom(payload: unknown): EnjoyerAuthority {
  const wrapper = payload as { blueprint?: EnjoyerAuthority } | null
  return (wrapper?.blueprint || payload || {}) as EnjoyerAuthority
}
function normalize(value: unknown): string {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(String).map(v => v.trim()).filter(Boolean))] : []
}
function pageArray(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.map(Number).filter(v => Number.isInteger(v) && v > 0))].sort((a, b) => a - b) : []
}
function sourceSpans(value: unknown): EnjoyerQuizSourceSpan[] {
  return Array.isArray(value) ? value.flatMap(raw => {
    const span = raw as Record<string, unknown>
    const page = Number(span.page)
    const quote = String(span.quote || span.text || '').trim()
    return Number.isInteger(page) && page > 0 && quote ? [{ page, quote }] : []
  }) : []
}

function canonicalFillBlankWordBank(raw: unknown, answer: string, seedParts: string[]): string[] | null {
  const candidates = [answer, ...stringArray(raw)]
  const seen = new Set<string>()
  const unique = candidates.filter(candidate => {
    const key = normalize(candidate)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (unique.length < 4) return null
  return shuffleWithSeed(unique.slice(0, 8), hashToSeed(...seedParts, 'fill_blank_word_bank_v1'))
}

/** Returns a short stable hash of a string safe for use in diagnostic/error messages. Does NOT expose raw ID. */
function stableIdHash(val: string): string {
  return createHash('sha256').update(val).digest('hex').slice(0, 8)
}

export function buildEnjoyerAssessmentUniverse(
  payload: unknown,
  selection: SourceSelectionSnapshot,
): EnjoyerAssessmentUniverse {
  const authority = authorityFrom(payload)
  if (authority.sourceSelectionFingerprint !== selection.fingerprint) throw new Error('SOURCE_SELECTION_MISMATCH')
  const selected = new Map(selection.materials.map(material => [material.materialId, new Set(material.selectedPages)]))
  const topics = (Array.isArray(authority.topicsIndex) ? authority.topicsIndex : []).map((raw, index) => {
    const topic = raw as Record<string, unknown>
    return { id: String(topic.id || `topic_${index}`), title: String(topic.title || ''), order: Number(topic.order ?? index) }
  })
  const topicTitles = new Map(topics.map(topic => [topic.id, topic.title]))
  const targets: EnjoyerAssessmentTarget[] = []
  const seenIds = new Set<string>()
  const exactContent = new Set<string>()
  const rawItems = [
    ...(Array.isArray(authority.globalOrderedAnalysis) ? authority.globalOrderedAnalysis : []),
    ...(Array.isArray(authority.uniqueConceptsIndex) ? authority.uniqueConceptsIndex : []),
  ]
  for (const [index, raw] of rawItems.entries()) {
    const item = raw as Record<string, unknown>
    const sourceItemId = String(item.id || `source_${index}`).trim()
    const title = String(item.name || item.label || item.title || '').trim()
    const content = String(item.summary || item.content || item.statement || '').trim()
    const kind = String(item.kind || 'concept').trim()
    if (!sourceItemId || seenIds.has(sourceItemId) || !title || !content || ['metadata', 'decorative', 'divider', 'heading'].includes(kind)) continue
    const identity = `${normalize(title)}::${normalize(content)}`
    if (exactContent.has(identity)) continue
    const materialIds = stringArray(item.materialIds)
    const materialId = String(item.materialId || materialIds[0] || selection.materialIds[0] || '')
    const pages = pageArray(item.pages)
    const spans = sourceSpans(item.sourceSpans)
    const authoritativePages = pages.length ? pages : pageArray(spans.map(span => span.page))
    const selectedPages = selected.get(materialId)
    if (!selectedPages || authoritativePages.some(page => !selectedPages.has(page))) throw new Error('SOURCE_SELECTION_MISMATCH')
    const topicIds = stringArray(item.topicIds)
    const topicId = String(item.topicId || topicIds[0] || '') || null
    seenIds.add(sourceItemId); exactContent.add(identity)
    targets.push({
      id: `assessment:${sourceItemId}`, sourceItemId, kind, title, content,
      importance: Number(item.importance ?? 50), difficulty: String(item.difficulty || 'intermediate'),
      examTypes: stringArray(item.examTypes), materialId, pages: authoritativePages, sourceSpans: spans,
      topicId, topicTitle: topicId ? topicTitles.get(topicId) || null : null,
      sourceOrder: Number(item.globalOrder ?? item.firstAppearanceOrder ?? index),
    })
  }
  targets.sort((a, b) => a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id))
  if (!targets.length) throw new Error('INSUFFICIENT_KNOWLEDGE')
  const unauthorizedTargetIds = new Set<string>()
  return { fingerprint: selection.fingerprint, targets, topics, unauthorizedTargetIds }
}

export type AssessmentDesignReasonCode =
  | 'MALFORMED_DESIGN'
  | 'INVALID_IDEAL_QUESTION_COUNT'
  | 'QUESTION_COUNT_EXCEEDS_MAX'
  | 'NO_VALID_TARGET_GROUPS'
  | 'EMPTY_TARGET_GROUP'
  | 'UNKNOWN_TARGET_ID'
  | 'UNAUTHORIZED_TARGET_ID'
  | 'UNCOVERED_TARGETS'

export interface AssessmentDesignValidationResult {
  valid: boolean
  errors: string[]
  reasonCode?: AssessmentDesignReasonCode
  design?: EnjoyerAssessmentDesign
  diagnostics?: Record<string, unknown>
}

export class AssessmentDesignValidationError extends Error {
  readonly reasonCode: AssessmentDesignReasonCode
  readonly diagnostics?: Record<string, unknown>

  constructor(message: string, reasonCode: AssessmentDesignReasonCode, diagnostics?: Record<string, unknown>) {
    super(message)
    this.name = 'AssessmentDesignValidationError'
    this.reasonCode = reasonCode
    this.diagnostics = diagnostics
  }
}

export function assessDesignValidation(
  raw: unknown,
  universe: EnjoyerAssessmentUniverse,
): AssessmentDesignValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      errors: ['INVALID_ASSESSMENT_DESIGN:MALFORMED_DESIGN:expected_object'],
      reasonCode: 'MALFORMED_DESIGN',
      diagnostics: { type: typeof raw },
    }
  }

  const value = raw as Record<string, unknown>
  const keys = Object.keys(value).filter(k => k !== '__providerTelemetry')
  if (keys.length === 0) {
    return {
      valid: false,
      errors: ['INVALID_ASSESSMENT_DESIGN:MALFORMED_DESIGN:empty_object'],
      reasonCode: 'MALFORMED_DESIGN',
      diagnostics: { keyCount: 0 },
    }
  }

  // 1. Validate idealQuestionCountForFullCoverage
  if (!('idealQuestionCountForFullCoverage' in value) || value.idealQuestionCountForFullCoverage === null || value.idealQuestionCountForFullCoverage === undefined) {
    return {
      valid: false,
      errors: ['INVALID_ASSESSMENT_DESIGN:INVALID_IDEAL_QUESTION_COUNT:missing_ideal_count'],
      reasonCode: 'INVALID_IDEAL_QUESTION_COUNT',
      diagnostics: { field: 'idealQuestionCountForFullCoverage' },
    }
  }

  const rawIdeal = value.idealQuestionCountForFullCoverage
  if (typeof rawIdeal !== 'number' && typeof rawIdeal !== 'string') {
    return {
      valid: false,
      errors: ['INVALID_ASSESSMENT_DESIGN:INVALID_IDEAL_QUESTION_COUNT:non_number'],
      reasonCode: 'INVALID_IDEAL_QUESTION_COUNT',
      diagnostics: { rawType: typeof rawIdeal },
    }
  }

  const ideal = typeof rawIdeal === 'number' ? rawIdeal : Number(rawIdeal)
  if (Number.isNaN(ideal) || !Number.isFinite(ideal)) {
    return {
      valid: false,
      errors: ['INVALID_ASSESSMENT_DESIGN:INVALID_IDEAL_QUESTION_COUNT:nan_or_infinite'],
      reasonCode: 'INVALID_IDEAL_QUESTION_COUNT',
      diagnostics: { rawType: typeof rawIdeal },
    }
  }

  if (!Number.isInteger(ideal)) {
    return {
      valid: false,
      errors: [`INVALID_ASSESSMENT_DESIGN:INVALID_IDEAL_QUESTION_COUNT:fractional_value_${ideal}`],
      reasonCode: 'INVALID_IDEAL_QUESTION_COUNT',
      diagnostics: { ideal },
    }
  }

  if (ideal < 1) {
    return {
      valid: false,
      errors: [`INVALID_ASSESSMENT_DESIGN:INVALID_IDEAL_QUESTION_COUNT:count_${ideal}_less_than_1`],
      reasonCode: 'INVALID_IDEAL_QUESTION_COUNT',
      diagnostics: { ideal },
    }
  }

  if (ideal > MAX_QUIZ_QUESTIONS) {
    return {
      valid: false,
      errors: [`INVALID_ASSESSMENT_DESIGN:QUESTION_COUNT_EXCEEDS_MAX:count_${ideal}_exceeds_${MAX_QUIZ_QUESTIONS}`],
      reasonCode: 'QUESTION_COUNT_EXCEEDS_MAX',
      diagnostics: { ideal, maxAllowed: MAX_QUIZ_QUESTIONS },
    }
  }

  // 2. Validate targetGroups
  if (!('targetGroups' in value) || !Array.isArray(value.targetGroups) || value.targetGroups.length === 0) {
    return {
      valid: false,
      errors: ['INVALID_ASSESSMENT_DESIGN:NO_VALID_TARGET_GROUPS:target_groups_empty_or_missing'],
      reasonCode: 'NO_VALID_TARGET_GROUPS',
      diagnostics: { groupCount: Array.isArray(value.targetGroups) ? value.targetGroups.length : 0 },
    }
  }

  if (value.targetGroups.length > MAX_QUIZ_QUESTIONS) {
    return {
      valid: false,
      errors: [`INVALID_ASSESSMENT_DESIGN:QUESTION_COUNT_EXCEEDS_MAX:groups_${value.targetGroups.length}_exceeds_${MAX_QUIZ_QUESTIONS}`],
      reasonCode: 'QUESTION_COUNT_EXCEEDS_MAX',
      diagnostics: { groupCount: value.targetGroups.length, maxAllowed: MAX_QUIZ_QUESTIONS },
    }
  }

  // Lookups for target IDs and aliases
  const byTarget = new Map(universe.targets.map(target => [target.id, target]))
  const bySource = new Map(universe.targets.map(target => [target.sourceItemId, target]))

  const normalizedGroups: EnjoyerAssessmentDesign['targetGroups'] = []

  for (const [groupIndex, rawGroup] of value.targetGroups.entries()) {
    if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) {
      return {
        valid: false,
        errors: [`INVALID_ASSESSMENT_DESIGN:MALFORMED_DESIGN:group_${groupIndex}_invalid_object`],
        reasonCode: 'MALFORMED_DESIGN',
        diagnostics: { groupIndex },
      }
    }

    const group = rawGroup as Record<string, unknown>
    const groupId = String(group.id || `group_${groupIndex}`).trim()
    const rawTargetIds = group.targetIds

    if (!Array.isArray(rawTargetIds) || rawTargetIds.length === 0) {
      return {
        valid: false,
        errors: [`INVALID_ASSESSMENT_DESIGN:EMPTY_TARGET_GROUP:group_${groupIndex}`],
        reasonCode: 'EMPTY_TARGET_GROUP',
        diagnostics: { groupIndex },
      }
    }

    const groupTargetIds: string[] = []
    for (const [targetIndex, rawId] of rawTargetIds.entries()) {
      if (typeof rawId !== 'string' || !rawId.trim()) {
        return {
          valid: false,
          errors: [`INVALID_ASSESSMENT_DESIGN:MALFORMED_DESIGN:group_${groupIndex}_target_${targetIndex}_invalid_id`],
          reasonCode: 'MALFORMED_DESIGN',
          diagnostics: { groupIndex, targetIndex },
        }
      }

      const idStr = rawId.trim()
      // Canonical or alias resolution
      if (byTarget.has(idStr)) {
        groupTargetIds.push(idStr)
      } else if (bySource.has(idStr)) {
        groupTargetIds.push(bySource.get(idStr)!.id)
      } else if (byTarget.has(`assessment:${idStr}`)) {
        groupTargetIds.push(`assessment:${idStr}`)
      } else {
        // ID is not found in universe.targets!
        // Determine UNAUTHORIZED vs UNKNOWN using the authoritative set — no lexical guessing.
        const idHash = stableIdHash(idStr)
        const isUnauthorized = universe.unauthorizedTargetIds?.has(idStr) === true
        if (isUnauthorized) {
          return {
            valid: false,
            errors: [`INVALID_ASSESSMENT_DESIGN:UNAUTHORIZED_TARGET_ID:group_${groupIndex}:id_${idHash}`],
            reasonCode: 'UNAUTHORIZED_TARGET_ID',
            diagnostics: { groupIndex, groupId: `group_${groupIndex}`, idHash },
          }
        }

        return {
          valid: false,
          errors: [`INVALID_ASSESSMENT_DESIGN:UNKNOWN_TARGET_ID:group_${groupIndex}:id_${idHash}`],
          reasonCode: 'UNKNOWN_TARGET_ID',
          diagnostics: { groupIndex, groupId: `group_${groupIndex}`, idHash },
        }
      }
    }

    if (groupTargetIds.length === 0) {
      return {
        valid: false,
        errors: [`INVALID_ASSESSMENT_DESIGN:EMPTY_TARGET_GROUP:group_${groupIndex}`],
        reasonCode: 'EMPTY_TARGET_GROUP',
        diagnostics: { groupIndex },
      }
    }

    normalizedGroups.push({
      id: groupId,
      targetIds: [...new Set(groupTargetIds)],
      rationale: String(group.rationale || ''),
    })
  }

  // 3. Coverage check
  const grouped = new Set(normalizedGroups.flatMap(group => group.targetIds))
  const uncovered = universe.targets.filter(target => !grouped.has(target.id))
  if (uncovered.length > 0) {
    // Fix 7: Include bounded missing target IDs so repair prompt knows what to add.
    // These are authoritative IDs already visible to the provider in the design prompt.
    const missingIds = uncovered.slice(0, 20).map(t => t.id)
    return {
      valid: false,
      errors: [`INVALID_ASSESSMENT_DESIGN:UNCOVERED_TARGETS:missing_${uncovered.length}_of_${universe.targets.length}_targets`],
      reasonCode: 'UNCOVERED_TARGETS',
      diagnostics: {
        missingCount: uncovered.length,
        totalTargets: universe.targets.length,
        coveredCount: grouped.size,
        missingTargetIds: missingIds,
      },
    }
  }

  // 4. Effective count bounded by MAX_QUIZ_QUESTIONS
  const coverageCompatibleIdeal = Math.max(ideal, normalizedGroups.length)
  if (coverageCompatibleIdeal > MAX_QUIZ_QUESTIONS) {
    return {
      valid: false,
      errors: [`INVALID_ASSESSMENT_DESIGN:QUESTION_COUNT_EXCEEDS_MAX:effective_${coverageCompatibleIdeal}_exceeds_${MAX_QUIZ_QUESTIONS}`],
      reasonCode: 'QUESTION_COUNT_EXCEEDS_MAX',
      diagnostics: { effectiveCount: coverageCompatibleIdeal, maxAllowed: MAX_QUIZ_QUESTIONS },
    }
  }

  return {
    valid: true,
    errors: [],
    design: {
      fingerprint: universe.fingerprint,
      idealQuestionCountForFullCoverage: coverageCompatibleIdeal,
      rationale: String(value.rationale || ''),
      targetGroups: normalizedGroups,
    },
  }
}

export function validateAssessmentDesign(raw: unknown, universe: EnjoyerAssessmentUniverse): EnjoyerAssessmentDesign {
  const result = assessDesignValidation(raw, universe)
  if (!result.valid || !result.design) {
    const errorMsg = result.errors[0] || 'INVALID_ASSESSMENT_DESIGN'
    throw new AssessmentDesignValidationError(
      errorMsg,
      result.reasonCode || 'MALFORMED_DESIGN',
      result.diagnostics,
    )
  }
  return result.design
}

export function enjoyerQuizCoverageRegime(requestedQuestionCount: number,
  idealQuestionCountForFullCoverage: number): 'compressed' | 'full' {
  return requestedQuestionCount < idealQuestionCountForFullCoverage ? 'compressed' : 'full'
}

function designPrompt(universe: EnjoyerAssessmentUniverse): string {
  return `Design an assessment coverage budget from an already-completed academic analysis. Do not analyze a PDF or invent knowledge.
Estimate the number of well-formed questions needed for full assessment coverage from the REAL density and structure of these targets. Do not use a fixed formula and do not assume one target equals one question.
The maximum allowed question count is ${MAX_QUIZ_QUESTIONS}. idealQuestionCountForFullCoverage must be an integer between 1 and ${MAX_QUIZ_QUESTIONS}.
Group related targets that can be assessed coherently together without creating compound monster questions. Every target ID in ALLOWED_TARGETS must appear in at least one group. A dense target may appear in multiple groups when academically useful. Do not exceed ${MAX_QUIZ_QUESTIONS} groups.
Return JSON only: {"idealQuestionCountForFullCoverage":number,"rationale":string,"targetGroups":[{"id":string,"targetIds":string[],"rationale":string}]}.
fingerprint=${universe.fingerprint}
topics=${JSON.stringify(universe.topics)}
targets=${JSON.stringify(universe.targets)}`
}
function generationPrompt(request: Parameters<EnjoyerQuizProvider>[0]): string {
  const frozenSlotTargetIds = (request.requiredSlots || []).map(slot => slot.primaryTargetId).filter(Boolean) as string[]
  const allowedIds = new Set(frozenSlotTargetIds.length
    ? frozenSlotTargetIds
    : request.focusTargetIds?.length ? request.focusTargetIds : request.universe.targets.map(target => target.id))
  const allowedTargets = request.universe.targets.filter(target => allowedIds.has(target.id)).map(target => ({
    assessmentTargetId: target.id, sourceItemId: target.sourceItemId, title: target.title,
    content: target.content.slice(0, 1800), kind: target.kind, topicId: target.topicId, topicTitle: target.topicTitle,
    sourceSpans: target.sourceSpans.slice(0, 3).map(span => ({ page: span.page, quote: span.quote.slice(0, 700) })),
  }))
  const requiredSlots = request.requiredSlots || []
  const atomicSlots = requiredSlots.some(slot => slot.primaryTargetId)
  return `Generate a grounded Quiz from an already-completed StudyalMaterialEnjoyer analysis. Do not analyze source files or use outside knowledge.
  Return exactly ${request.missingSlots ?? request.requestedCount} questions in REQUIRED_SLOTS order. Each output question MUST use the type assigned to its corresponding slot. The type allocation is authoritative; do not choose or substitute question types. Each question must be one coherent assessment task, not independent questions joined together.
${atomicSlots
    ? 'For every question, copy its REQUIRED_SLOTS slotId exactly. Each slot is one atomic primary target with a server-selected question type. The server owns and attaches the academic target; do not return or choose assessment target IDs.'
    : `When requestedQuestionCount is below idealQuestionCountForFullCoverage, maximize representation across the whole material and all relevant topics. Related targets may share one coherent question. Importance influences prioritization but never erases unique low-importance academic knowledge.
When the budget reaches full coverage, use more atomic granularity. Multiple questions may cite the same dense target. For every question, assessmentTargetIds MUST be copied exactly from ALLOWED_TARGETS below. Never invent, shorten, translate, or substitute an ID. The backend derives sourceItemIds/pages/sourceSpans canonically from those IDs; do not output provenance copies.`}
Canonical payloads by type:
- multiple_choice: options:string[] (2+), correctAnswer:number (zero-based option index).
- multi_select: options:string[] (3+), correctAnswers:number[] (zero-based indices, at least two distinct correct answers).
- true_false: correctAnswer:boolean.
- fill_blank: question MUST contain answer verbatim exactly once and MUST NOT contain a blank token or capture marker. answer:string is that exact text. The backend creates the visible blank safely. wordBank:string[] MUST contain the answer plus at least 3 plausible distinct distractors (4-8 total).
- matching: pairs:[{"left":string,"right":string}] with 2+ grounded pairs.
- short_answer: acceptedAnswers:string[] with at least one concise grounded answer; caseInsensitive:boolean.
Correct answers, accepted answers, and both sides of matching pairs must use words, symbols, formulas, names, or values present in the cited target content. Distractors may be plausible but must not be cited as correct.
${request.mode === 'repair' ? 'Generate only missing questions for the allowed coverage gaps. Do not repeat any normalized stem in EXISTING_QUESTIONS.' : 'Avoid every normalized stem in EXISTING_QUESTIONS.'}
Return JSON only: {"questions":[{"slotId"?:string,"type":"multiple_choice|multi_select|true_false|fill_blank|matching|short_answer","question":string,"explanation":string,"assessmentTargetIds"?:string[],"options"?:string[],"correctAnswer"?:number|boolean,"correctAnswers"?:number[],"answer"?:string,"wordBank"?:string[],"pairs"?:[{"left":string,"right":string}],"acceptedAnswers"?:string[],"caseInsensitive"?:boolean}]}.
CONFIG=${JSON.stringify(request.config)}
REQUESTED_CHUNK=${request.missingSlots ?? request.requestedCount}
REQUIRED_SLOTS=${JSON.stringify(requiredSlots)}
${request.design ? `IDEAL_FULL_COVERAGE=${request.design.idealQuestionCountForFullCoverage}` : ''}
EXISTING_QUESTIONS=${JSON.stringify((request.existingQuestions || []).slice(-16))}
ALLOWED_ASSESSMENT_TARGET_IDS=${JSON.stringify([...allowedIds])}
ALLOWED_TARGETS=${JSON.stringify(allowedTargets)}`
}

export async function defaultEnjoyerQuizProvider(request: Parameters<EnjoyerQuizProvider>[0],
  transport?: import('../../ai/legacyRouteGeneration').LegacyJsonGenerationInput<unknown>['provider'],
): Promise<unknown> {
  const isDesign = request.mode === 'design'
  let formatRepairCalls = 0
  let providerCalls = 0
  const value = await generateValidatedLegacyJson<unknown>({
    provider: transport, taskType: 'evaluation_question', prompt: isDesign ? designPrompt(request.universe) : generationPrompt(request),
    maxTokens: isDesign ? 4000 : Math.min(12_000, 1400 + Number(request.missingSlots ?? request.requestedCount ?? 1) * 650),
    failurePath: 'single_repair', normalize: value => value, recoverableArrayKeys: isDesign ? undefined : ['questions'],
    beforeProviderAttempt: context => { providerCalls++; if (context.stage === 'format_repair') formatRepairCalls++ },
    validate: value => {
      if (isDesign) {
        const assessmentResult = assessDesignValidation(value, request.universe)
        return {
          valid: assessmentResult.valid,
          errors: assessmentResult.errors,
        }
      }
      const hasQuestions = value && typeof value === 'object' && Array.isArray((value as { questions?: unknown[] }).questions)
      return {
        valid: Boolean(hasQuestions),
        errors: hasQuestions ? [] : ['INVALID_QUIZ_ENJOYER_OUTPUT'],
      }
    },
    telemetryContext: { route: 'quiz_enjoyer', phase: request.mode },
  })
  return value && typeof value === 'object' ? { ...(value as Record<string, unknown>),
    __providerTelemetry: { formatRepairCalls, providerCalls } } : value
}

function validateQuestion(raw: ProviderQuestion, universe: EnjoyerAssessmentUniverse, config: QuizConfig,
  seenQuestions: Set<string>, allowedTargets?: Set<string>, rejectionCounts?: Record<string, number>,
  requiredType?: QuizQuestionType, rejectedByType?: Record<string, number>,
  atomicSlot?: QuizAtomicSlot): EnjoyerGroundedQuizQuestion | null {
  const reject = (category: string) => {
    if (rejectionCounts) rejectionCounts[category] = (rejectionCounts[category] || 0) + 1
    const diagnosticType = requiredType || String(raw.type || 'unknown')
    if (rejectedByType) rejectedByType[diagnosticType] = (rejectedByType[diagnosticType] || 0) + 1
    return null
  }
  const rawType = String(raw.type || '').trim()
  const typeAliases: Record<string, QuizQuestionType> = {
    multiple_answers: 'multi_select', multiple_answer: 'multi_select', boolean: 'true_false',
  }
  const type = (typeAliases[rawType] || rawType) as QuizQuestionType
  let question = String(raw.question || '').trim()
  const fillBlankAnswer = type === 'fill_blank'
    ? String(raw.answer || (Array.isArray(raw.acceptedAnswers) ? raw.acceptedAnswers[0] : '') || '').trim()
    : ''
  if (type === 'fill_blank') question = canonicalizeGeneratedFillBlankPrompt(question, fillBlankAnswer) || ''
  const explanation = String(raw.explanation || '').trim()
  const byTarget = new Map(universe.targets.map(target => [target.id, target]))
  const bySource = new Map(universe.targets.map(target => [target.sourceItemId, target]))
  if (atomicSlot && String(raw.slotId || '') !== atomicSlot.slotId) return reject('wrong_slot_id')
  const targetIds = atomicSlot ? [atomicSlot.primaryTargetId]
    : stringArray(raw.assessmentTargetIds).map(id => byTarget.has(id) ? id
      : bySource.get(id)?.id || (byTarget.has(`assessment:${id}`) ? `assessment:${id}` : id))
  const sourceItemIds = [...new Set(targetIds.flatMap(id => byTarget.get(id)?.sourceItemId || []))]
  const normalizedQuestion = normalize(question)
  if (!config.questionTypes.includes(type) || (requiredType && type !== requiredType) || !question || !explanation) {
    return reject(requiredType && type !== requiredType ? 'wrong_required_type' : 'invalid_shape_or_type')
  }
  if (seenQuestions.has(normalizedQuestion)) return reject('duplicate_question')
  if (!targetIds.length || targetIds.some(id => !byTarget.has(id) || (allowedTargets && !allowedTargets.has(id)))) {
    return reject('invalid_or_out_of_focus_target_ids')
  }
  const spans = targetIds.flatMap(id => {
    const target = byTarget.get(id)!
    return target.sourceSpans.map(span => ({ materialId: target.materialId, page: span.page, quote: span.quote }))
  })
  const targetsRequiringSpans = targetIds.filter(id => byTarget.get(id)!.pages.length > 0)
  if (targetsRequiringSpans.length && (spans.length === 0 || targetsRequiringSpans.some(id => {
    const target = byTarget.get(id)!; return !spans.some(span => span.materialId === target.materialId && target.pages.includes(span.page))
  }))) return reject('invalid_source_spans')
  const groundingText = normalize(targetIds.map(id => {
    const target = byTarget.get(id)!
    return `${target.title} ${target.content} ${target.sourceSpans.map(span => span.quote).join(' ')}`
  }).join(' '))
  const groundingTokens = new Set(groundingText.split(' ').filter(Boolean))
  const harmlessAnswerWords = new Set(['a', 'al', 'de', 'del', 'el', 'en', 'es', 'la', 'las', 'lo', 'los', 'o', 'por', 'que', 'se', 'un', 'una', 'y'])
  const answerIsSupported = (answer: unknown) => {
    const tokens = normalize(answer).split(' ').filter(token => token && !harmlessAnswerWords.has(token))
    return tokens.length > 0 && tokens.every(token => groundingTokens.has(token))
  }
  const base = { id: `enjoyer-quiz:${createHash('sha256').update(`${universe.fingerprint}:${normalizedQuestion}`).digest('hex').slice(0, 20)}`,
    type, question, explanation, difficulty: config.difficulty,
    sourceMaterial: byTarget.get(targetIds[0])!.materialId, sourcePage: byTarget.get(targetIds[0])!.pages[0] }
  let typed: QuizQuestion
  let canonicalAnswer = ''
  if (type === 'multiple_choice') {
    const options = stringArray(raw.options)
    const rawCorrect = raw.correctAnswer
    const correctAnswer = typeof rawCorrect === 'string' && !/^\d+$/.test(rawCorrect.trim())
      ? options.findIndex(option => normalize(option) === normalize(rawCorrect)) : Number(rawCorrect)
    if (options.length < 2 || !Number.isInteger(correctAnswer) || correctAnswer < 0 || correctAnswer >= options.length) return reject('malformed_answer_payload')
    if (!answerIsSupported(options[correctAnswer])) return reject('unsupported_answer')
    typed = { ...base, type, options, correctAnswer }
    canonicalAnswer = options[correctAnswer]
  } else if (type === 'multi_select') {
    const options = stringArray(raw.options); const correctAnswers = Array.isArray(raw.correctAnswers) ? raw.correctAnswers.map(value =>
      typeof value === 'string' && !/^\d+$/.test(value.trim())
        ? options.findIndex(option => normalize(option) === normalize(value)) : Number(value)) : []
    if (options.length < 3
      || correctAnswers.length < 2
      || new Set(correctAnswers).size !== correctAnswers.length
      || correctAnswers.some(i => !Number.isInteger(i) || i < 0 || i >= options.length)) return reject('malformed_answer_payload')
    if (correctAnswers.some(index => !answerIsSupported(options[index]))) return reject('unsupported_answer')
    typed = { ...base, type, options, correctAnswers }
    canonicalAnswer = correctAnswers.map(index => options[index]).join(' | ')
  } else if (type === 'true_false') {
    const normalizedBoolean = typeof raw.correctAnswer === 'boolean' ? raw.correctAnswer
      : ['true', 'verdadero'].includes(String(raw.correctAnswer).toLowerCase()) ? true
        : ['false', 'falso'].includes(String(raw.correctAnswer).toLowerCase()) ? false : null
    if (normalizedBoolean === null) return reject('malformed_answer_payload')
    typed = { ...base, type, correctAnswer: normalizedBoolean }
    canonicalAnswer = String(normalizedBoolean)
  } else if (type === 'fill_blank') {
    const answer = fillBlankAnswer
    const wordBank = canonicalFillBlankWordBank(raw.wordBank, answer,
      [universe.fingerprint, normalizedQuestion, answer])
    if (!answer || !question || !wordBank) return reject('malformed_answer_payload')
    if (!answerIsSupported(answer)) return reject('unsupported_answer')
    typed = { ...base, type, answer, wordBank }
    canonicalAnswer = answer
  } else if (type === 'matching') {
    const pairs = Array.isArray(raw.pairs) ? raw.pairs.flatMap(pairRaw => {
      const pair = pairRaw as Record<string, unknown>; const left = String(pair.left || '').trim(); const right = String(pair.right || '').trim()
      return left && right ? [{ left, right }] : []
    }) : []; if (pairs.length < 2) return reject('malformed_answer_payload')
    if (pairs.some(pair => !answerIsSupported(pair.left) || !answerIsSupported(pair.right))) return reject('unsupported_answer')
    typed = { ...base, type, pairs }
    canonicalAnswer = pairs.map(pair => `${pair.left} → ${pair.right}`).join(' | ')
  } else if (type === 'short_answer') {
    const acceptedAnswers = stringArray(Array.isArray(raw.acceptedAnswers) ? raw.acceptedAnswers
      : raw.answer ? [raw.answer] : []); if (!acceptedAnswers.length) return reject('malformed_answer_payload')
    if (!acceptedAnswers.some(answerIsSupported)) return reject('unsupported_answer')
    typed = { ...base, type, acceptedAnswers, caseInsensitive: raw.caseInsensitive !== false }
    canonicalAnswer = acceptedAnswers[0]
  } else return reject('invalid_shape_or_type')
  seenQuestions.add(normalizedQuestion)
  const assertionIds = targetIds.map(id => `enjoyer:${id}`)
  const accepted = { ...typed, grounding: {
    authorityVersion: ENJOYER_QUIZ_AUTHORITY_VERSION, sourceSelectionFingerprint: universe.fingerprint,
    assessmentTargetIds: targetIds, sourceItemIds, evidence: spans,
    supportingText: spans.map(span => span.quote).join(' | ') || targetIds.map(id => byTarget.get(id)!.content).join(' | '),
    answerTarget: { kind: 'single_text', assertionIds, canonicalValue: canonicalAnswer },
    groundingTarget: { evidenceBackedAssertionIds: assertionIds, sourceUnitIds: sourceItemIds, sourceRelationIds: [] },
    planId: `enjoyer-plan:${targetIds.join('+')}`, slotId: atomicSlot?.slotId || '', candidateId: `enjoyer:${targetIds.join('+')}`,
  } } as EnjoyerGroundedQuizQuestion
  return accepted
}

export function computeEnjoyerQuizCoverage(universe: EnjoyerAssessmentUniverse, questions: EnjoyerGroundedQuizQuestion[],
  requestedQuestionCount: number, idealQuestionCountForFullCoverage: number): EnjoyerQuizCoverage {
  const known = new Set(universe.targets.map(target => target.id))
  const coveredTargetIds = [...new Set(questions.flatMap(q => q.grounding.assessmentTargetIds).filter(id => known.has(id)))].sort()
  const covered = new Set(coveredTargetIds)
  const uncoveredTargetIds = universe.targets.map(target => target.id).filter(id => !covered.has(id))
  const topicCoverage = universe.topics.map(topic => {
    const ids = universe.targets.filter(target => target.topicId === topic.id).map(target => target.id)
    return { topicId: topic.id, topicTitle: topic.title, covered: ids.filter(id => covered.has(id)).length, total: ids.length }
  }).filter(topic => topic.total > 0)
  const coveragePercent = known.size ? Math.round(covered.size / known.size * 10_000) / 100 : 0
  return {
    totalAssessableTargets: known.size,
    coveredTargetCount: covered.size,
    uncoveredTargetCount: uncoveredTargetIds.length,
    estimatedCoveragePercent: coveragePercent,
    mode: uncoveredTargetIds.length === 0 && known.size > 0 ? 'practice' : 'first_pass',
    coveredTargetIds, uncoveredTargetIds, topicCoverage, coveragePercent,
    coverageStatus: covered.size === known.size ? 'complete' : covered.size ? 'partial' : 'failed',
    requestedQuestionCount, idealQuestionCountForFullCoverage }
}

function questionCoverageRepairTargets(universe: EnjoyerAssessmentUniverse, coverage: EnjoyerQuizCoverage,
  requested: number, ideal: number): string[] {
  // A compressed quiz intentionally cannot cover every target identity. Topic
  // diversity is supplied to the initial generator through the frozen universe
  // and assessment design; it is not a terminal validity invariant. Structural
  // failures (missing slot, wrong type, duplicate, malformed or ungrounded
  // question) have already been rejected by generateQuestionChunk and repaired
  // before this function runs. Replacing valid questions here merely to improve
  // a soft topic ratio adds provider calls and can discard other unique coverage.
  if (requested < ideal) return []
  return coverage.uncoveredTargetIds
}

function replacementVictimIndex(universe: EnjoyerAssessmentUniverse, questions: EnjoyerGroundedQuizQuestion[]): number {
  const targetCounts = new Map<string, number>()
  const topicQuestionCounts = new Map<string, number>()
  const topicByTarget = new Map(universe.targets.map(target => [target.id, target.topicId]))
  for (const question of questions) {
    for (const id of new Set(question.grounding.assessmentTargetIds)) targetCounts.set(id, (targetCounts.get(id) || 0) + 1)
    for (const topicId of new Set(question.grounding.assessmentTargetIds.map(id => topicByTarget.get(id)).filter(Boolean))) {
      topicQuestionCounts.set(topicId!, (topicQuestionCounts.get(topicId!) || 0) + 1)
    }
  }
  let best = -1
  let bestScore = Number.POSITIVE_INFINITY
  questions.forEach((question, index) => {
    const ids = [...new Set(question.grounding.assessmentTargetIds)]
    const uniqueTargets = ids.filter(id => targetCounts.get(id) === 1).length
    const soleTopic = [...new Set(ids.map(id => topicByTarget.get(id)).filter(Boolean))]
      .some(topicId => topicQuestionCounts.get(topicId!) === 1)
    const score = uniqueTargets * 100 + (soleTopic ? 10_000 : 0) + ids.length
    if (score < bestScore) { bestScore = score; best = index }
  })
  return best
}

async function repairCoverageByReplacement(params: {
  universe: EnjoyerAssessmentUniverse; design: EnjoyerAssessmentDesign; config: QuizConfig
  provider: EnjoyerQuizProvider; questions: EnjoyerGroundedQuizQuestion[]; seen: Set<string>
}): Promise<{ questions: EnjoyerGroundedQuizQuestion[]; coverage: EnjoyerQuizCoverage; attempts: number; replaced: number;
  providerCalls: number; rejectedByType: Record<string, number>; repairAttemptsByType: Record<string, number> }> {
  const { universe, design, config, provider, seen } = params
  const questions = [...params.questions]
  let coverage = computeEnjoyerQuizCoverage(universe, questions, config.questionCount, design.idealQuestionCountForFullCoverage)
  let attempts = 0; let replaced = 0; let providerCalls = 0
  const rejectedByType: Record<string, number> = {}
  const repairAttemptsByType: Record<string, number> = {}
  while (attempts < MAX_REPAIR_ATTEMPTS) {
    const gaps = questionCoverageRepairTargets(universe, coverage, config.questionCount, design.idealQuestionCountForFullCoverage)
    const coverageRegime = enjoyerQuizCoverageRegime(config.questionCount, design.idealQuestionCountForFullCoverage)
    const terminalRepairReason = !gaps.length ? 'none'
      : coverageRegime === 'full' ? 'full_target_coverage_gap' : 'underrepresented_topic_gap'
    if (process.env.NODE_ENV !== 'production') console.info('[enjoyer-quiz-coverage-budget]', JSON.stringify({
      requestedQuestionCount: config.questionCount,
      idealQuestionCountForFullCoverage: design.idealQuestionCountForFullCoverage,
      assessmentTargetCount: universe.targets.length,
      coveredTargetCount: coverage.coveredTargetIds.length,
      uncoveredTargetCount: coverage.uncoveredTargetIds.length,
      topicCount: coverage.topicCoverage.length,
      coveragePercent: coverage.coveragePercent,
      coverageRegime,
      terminalRepairReason,
    }))
    if (!gaps.length) {
      if (process.env.NODE_ENV !== 'production') console.info('[enjoyer-quiz-final-repair]', JSON.stringify({
        reason: 'none', readySlots: questions.length, missingSlots: Math.max(0, config.questionCount - questions.length),
        coveragePercent: coverage.coveragePercent, uncoveredTargetCount: coverage.uncoveredTargetIds.length,
        victimSlot: null, victimType: null, providerCallRequired: false,
      }))
      break
    }
    const victimIndex = replacementVictimIndex(universe, questions)
    if (victimIndex < 0) break
    const reason = terminalRepairReason
    if (process.env.NODE_ENV !== 'production') console.info('[enjoyer-quiz-final-repair]', JSON.stringify({
      reason, readySlots: questions.length, missingSlots: Math.max(0, config.questionCount - questions.length),
      coveragePercent: coverage.coveragePercent, uncoveredTargetCount: coverage.uncoveredTargetIds.length,
      victimSlot: victimIndex + 1, victimType: questions[victimIndex].type, providerCallRequired: true,
    }))
    attempts++; providerCalls++
    const requiredType = questions[victimIndex].type
    repairAttemptsByType[requiredType] = (repairAttemptsByType[requiredType] || 0) + 1
    const rawRepair = await provider({ mode: 'repair', universe, design, config,
      requestedCount: config.questionCount, missingSlots: 1, focusTargetIds: gaps,
      requiredSlots: [{ slot: victimIndex + 1, type: requiredType }],
      existingQuestions: questions.filter((_, index) => index !== victimIndex)
        .map(q => ({ question: q.question, normalizedStem: normalize(q.question), sourceItemIds: q.grounding.sourceItemIds,
          assessmentTargetIds: q.grounding.assessmentTargetIds })) })
    const candidates = Array.isArray((rawRepair as any)?.questions) ? (rawRepair as any).questions : []
    const valid = candidates.map(candidate => validateQuestion(candidate, universe, config, seen, new Set(gaps), undefined,
      requiredType, rejectedByType)).find(Boolean)
    if (!valid) continue
    const previous = questions[victimIndex]
    questions[victimIndex] = valid
    const next = computeEnjoyerQuizCoverage(universe, questions, config.questionCount, design.idealQuestionCountForFullCoverage)
    const previousGaps = questionCoverageRepairTargets(universe, coverage, config.questionCount, design.idealQuestionCountForFullCoverage)
    const nextGaps = questionCoverageRepairTargets(universe, next, config.questionCount, design.idealQuestionCountForFullCoverage)
    if (nextGaps.length >= previousGaps.length && next.coveragePercent <= coverage.coveragePercent) {
      questions[victimIndex] = previous
      continue
    }
    replaced++; coverage = next
  }
  return { questions, coverage, attempts, replaced, providerCalls, rejectedByType, repairAttemptsByType }
}

async function generateQuestionChunk(params: {
  universe: EnjoyerAssessmentUniverse; design?: EnjoyerAssessmentDesign; config: QuizConfig
  provider: EnjoyerQuizProvider; questions: EnjoyerGroundedQuizQuestion[]; requiredTypes?: QuizQuestionType[]
  requiredSlots?: QuizAtomicSlot[]
}): Promise<{ questions: EnjoyerGroundedQuizQuestion[]; providerCalls: number; repairAttempts: number;
  rejectionCounts: Record<string, number>; rejectedByType: Record<string, number>;
  repairAttemptsByType: Record<string, number> }> {
  const { universe, design, config, provider } = params
  const startedAt = Date.now()
  const questions = [...params.questions]
  const initialCount = questions.length
  const seen = new Set(questions.map(question => normalize(question.question)))
  let providerCalls = 0; let repairAttempts = 0
  const rejectionCounts: Record<string, number> = {}
  const rejectedByType: Record<string, number> = {}
  const repairAttemptsByType: Record<string, number> = {}
  let providerReturnedCount = 0; let formatRepairCalls = 0
  const coverage = computeEnjoyerQuizCoverage(universe, questions, config.questionCount,
    design?.idealQuestionCountForFullCoverage || universe.targets.length)
  const preferred = coverage.uncoveredTargetIds.length ? coverage.uncoveredTargetIds : universe.targets.map(target => target.id)
  const atomicSlots = params.requiredSlots || []
  const atomicTargetIds = new Set(atomicSlots.map(slot => slot.primaryTargetId))
  const providerUniverse = atomicSlots.length
    ? {
        ...universe,
        targets: universe.targets.filter(target => atomicTargetIds.has(target.id)),
        topics: universe.topics.filter(topic => universe.targets.some(target =>
          atomicTargetIds.has(target.id) && target.topicId === topic.id)),
      }
    : universe
  const initialRequiredTypes = atomicSlots.length ? atomicSlots.map(slot => slot.type) : [...(params.requiredTypes || [])]
  const providerSlots = atomicSlots.length
    ? atomicSlots.map((slot, index) => ({ slot: initialCount + index + 1, slotId: slot.slotId,
        type: slot.type, primaryTargetId: slot.primaryTargetId }))
    : initialRequiredTypes.map((type, index) => ({ slot: initialCount + index + 1, type }))
  const focusTargetIds = atomicSlots.length ? atomicSlots.map(slot => slot.primaryTargetId) : preferred
  const raw = await provider({ mode: 'generate', universe: providerUniverse, design, config, requestedCount: config.questionCount,
    missingSlots: initialRequiredTypes.length, focusTargetIds,
    requiredSlots: providerSlots,
    existingQuestions: questions.slice(-16).map(q => ({ question: q.question, normalizedStem: normalize(q.question),
      sourceItemIds: q.grounding.sourceItemIds, assessmentTargetIds: q.grounding.assessmentTargetIds })) })
  providerCalls++
  const firstPassCandidates = Array.isArray((raw as any)?.questions) ? (raw as any).questions : []
  providerReturnedCount += firstPassCandidates.length
  formatRepairCalls += Number((raw as any)?.__providerTelemetry?.formatRepairCalls || 0)
  for (const [index, slot] of providerSlots.entries()) {
    const candidate = atomicSlots.length
      ? firstPassCandidates.find(value => String(value?.slotId || '') === atomicSlots[index].slotId)
      : firstPassCandidates[index]
    if (!candidate) continue
    const valid = validateQuestion(candidate, universe, config, seen,
      atomicSlots.length ? new Set([atomicSlots[index].primaryTargetId]) : undefined, rejectionCounts,
      initialRequiredTypes[index], rejectedByType, atomicSlots[index])
    if (valid) questions.push(valid)
  }
  const acceptedFirstPass = questions.length - initialCount
  let missingAtomicSlots = atomicSlots.filter(slot => !questions.some(question => question.grounding.slotId === slot.slotId))
  let missingTypes = atomicSlots.length ? missingAtomicSlots.map(slot => slot.type)
    : remainingTypePlan(initialRequiredTypes, questions.slice(initialCount))
  while (missingTypes.length && repairAttempts < MAX_REPAIR_ATTEMPTS) {
    repairAttempts++; providerCalls++
    const repairTypes = [...missingTypes]
    for (const type of new Set(repairTypes)) repairAttemptsByType[type] = (repairAttemptsByType[type] || 0) + 1
    const current = computeEnjoyerQuizCoverage(universe, questions, config.questionCount,
      design?.idealQuestionCountForFullCoverage || universe.targets.length)
    const focus = current.uncoveredTargetIds.length ? current.uncoveredTargetIds : universe.targets.map(target => target.id)
    const repairSlots = atomicSlots.length ? missingAtomicSlots : []
    const repaired = await provider({ mode: 'repair', universe: providerUniverse, design, config, requestedCount: config.questionCount,
      missingSlots: repairTypes.length,
      focusTargetIds: repairSlots.length ? repairSlots.map(slot => slot.primaryTargetId) : focus,
      requiredSlots: repairSlots.length
        ? repairSlots.map((slot, index) => ({ slot: questions.length + index + 1, slotId: slot.slotId,
            type: slot.type, primaryTargetId: slot.primaryTargetId }))
        : repairTypes.map((type, index) => ({ slot: questions.length + index + 1, type })),
      existingQuestions: questions.slice(-16).map(q => ({ question: q.question, normalizedStem: normalize(q.question),
        sourceItemIds: q.grounding.sourceItemIds, assessmentTargetIds: q.grounding.assessmentTargetIds })) })
    const repairCandidates = Array.isArray((repaired as any)?.questions) ? (repaired as any).questions : []
    providerReturnedCount += repairCandidates.length
    formatRepairCalls += Number((repaired as any)?.__providerTelemetry?.formatRepairCalls || 0)
    for (const [index, type] of repairTypes.entries()) {
      const slot = repairSlots[index]
      const candidate = slot
        ? repairCandidates.find(value => String(value?.slotId || '') === slot.slotId)
        : repairCandidates[index]
      if (!candidate) continue
      const valid = validateQuestion(candidate, universe, config, seen,
        slot ? new Set([slot.primaryTargetId]) : new Set(focus), rejectionCounts,
        type, rejectedByType, slot)
      if (valid) questions.push(valid)
    }
    missingAtomicSlots = atomicSlots.filter(slot => !questions.some(question => question.grounding.slotId === slot.slotId))
    missingTypes = atomicSlots.length ? missingAtomicSlots.map(slot => slot.type)
      : remainingTypePlan(initialRequiredTypes, questions.slice(initialCount))
  }
  if (process.env.NODE_ENV !== 'production') console.info('[enjoyer-quiz-batch-quality]', JSON.stringify({
    phase: 'progressive_chunk', requestedChunkSize: initialRequiredTypes.length, providerReturnedCount,
    acceptedFirstPass, acceptedAfterRepair: questions.length - initialCount,
    rejectedByCategory: rejectionCounts, repairCalls: repairAttempts, formatRepairCalls,
    batchDurationMs: Date.now() - startedAt,
  }))
  return { questions, providerCalls, repairAttempts, rejectionCounts, rejectedByType, repairAttemptsByType }
}

export async function generateEnjoyerQuizArtifact(params: {
  payload: unknown; selection: SourceSelectionSnapshot; sessionId: string; config: unknown
  provider?: EnjoyerQuizProvider; design?: EnjoyerAssessmentDesign; generationId?: string
}): Promise<EnjoyerQuizArtifact> {
  const universe = buildEnjoyerAssessmentUniverse(params.payload, params.selection)
  const config = normalizeEnjoyerQuizConfig(params.config)
  const provider = params.provider || defaultEnjoyerQuizProvider
  let providerCalls = 0
  const design = params.design
    ? validateAssessmentDesign(params.design, universe)
    : validateAssessmentDesign(await provider({ mode: 'design', universe }), universe)
  if (!params.design) providerCalls++
  if (design.fingerprint !== universe.fingerprint) throw new Error('SOURCE_SELECTION_MISMATCH')
  let questions: EnjoyerGroundedQuizQuestion[] = []
  const typePlan = buildEnjoyerQuizTypePlan(config)
  let repairAttempts = 0
  while (questions.length < config.questionCount) {
    const beforeCount = questions.length
    const requiredTypes = remainingTypePlan(typePlan, questions).slice(0, MAX_GENERATION_BATCH_SIZE)
    const chunk = await generateQuestionChunk({ universe, design, config, provider, questions, requiredTypes })
    questions = chunk.questions; providerCalls += chunk.providerCalls; repairAttempts += chunk.repairAttempts
    if (questions.length === beforeCount) break
  }
  if (questions.length !== config.questionCount) throw new Error('INSUFFICIENT_VALID_QUESTIONS')
  const repaired = await repairCoverageByReplacement({ universe, design, config, provider, questions,
    seen: new Set(questions.map(question => normalize(question.question))) })
  questions = repaired.questions; providerCalls += repaired.providerCalls
  questions.forEach((question, index) => { question.grounding.slotId = `enjoyer-slot:${index + 1}` })
  const coverage = repaired.coverage
  return { meta: { schemaVersion: ENJOYER_QUIZ_SCHEMA_VERSION, authorityVersion: ENJOYER_QUIZ_AUTHORITY_VERSION,
      generatorVersion: ENJOYER_QUIZ_GENERATOR_VERSION, authoritativeSessionId: params.sessionId,
      sourceSelectionFingerprint: universe.fingerprint, configFingerprint: quizConfigFingerprint(config),
      generationId: params.generationId || randomUUID(), generatedAt: new Date().toISOString(), status: 'ready',
      llmCallsUsed: providerCalls, repairAttempts, coverageRepairAttempts: repaired.attempts,
      questionsReplacedForCoverage: repaired.replaced, finalCoveragePercent: coverage.coveragePercent,
      finalTopicCoverage: coverage.topicCoverage }, config, questions, coverage, design }
}

export function quizConfigFingerprint(config: QuizConfig): string {
  return createHash('sha256').update(JSON.stringify({ ...config, questionTypes: [...config.questionTypes].sort() })).digest('hex')
}
export function enjoyerQuizArtifactIdentity(sessionId: string, fingerprint: string, configFingerprint: string, generationId: string): string {
  return createHash('sha256').update(JSON.stringify({ sessionId, fingerprint, configFingerprint, generationId,
    schemaVersion: ENJOYER_QUIZ_SCHEMA_VERSION, authorityVersion: ENJOYER_QUIZ_AUTHORITY_VERSION,
    generatorVersion: ENJOYER_QUIZ_GENERATOR_VERSION })).digest('hex')
}

const progressiveInFlight = new Map<string, Promise<EnjoyerQuizProgressiveResult>>()
const PROGRESSIVE_LEASE_MS = 120_000

function mergeRejectionCounts(target: Record<string, number>, incoming: Record<string, number>) {
  for (const [category, count] of Object.entries(incoming)) target[category] = (target[category] || 0) + count
}

function countQuestionTypes(types: readonly QuizQuestionType[]): Record<string, number> {
  return types.reduce<Record<string, number>>((counts, type) => {
    counts[type] = (counts[type] || 0) + 1
    return counts
  }, {})
}

function logTypePlan(manifest: EnjoyerQuizGenerationManifest, questions: EnjoyerGroundedQuizQuestion[]) {
  if (process.env.NODE_ENV === 'production') return
  console.info('[enjoyer-quiz-type-plan]', JSON.stringify({
    selectedTypes: manifest.config.questionTypes,
    requestedCount: manifest.totalSlots,
    targetCountsByType: countQuestionTypes(manifest.typePlan),
    readyCountsByType: countQuestionTypes(questions.map(question => question.type)),
    missingCountsByType: countQuestionTypes(remainingTypePlan(manifest.typePlan, questions)),
    rejectedByType: manifest.rejectedByType,
    repairAttemptsByType: manifest.repairAttemptsByType,
    redistributedSlots: manifest.redistributedSlots,
  }))
}

function logProgressiveState(manifest: EnjoyerQuizGenerationManifest, returnedQuestions: number,
  nextChunkSize: number, advanceRequested: boolean) {
  if (process.env.NODE_ENV === 'production') return
  console.info('[enjoyer-quiz-progressive]', JSON.stringify({
    requestedCount: manifest.config.questionCount,
    manifestSlots: manifest.totalSlots,
    readySlots: manifest.readyCount,
    missingSlots: Math.max(0, manifest.totalSlots - manifest.readyCount),
    returnedQuestions,
    status: manifest.status,
    nextChunkSize,
    advanceRequested,
    rejectionCounts: manifest.rejectionCounts,
  }))
}

export async function runEnjoyerProgressiveChunk(params: {
  manifest: EnjoyerQuizGenerationManifest; artifact: EnjoyerQuizArtifact; store: EnjoyerQuizStore
  provider?: EnjoyerQuizProvider
}): Promise<EnjoyerQuizProgressiveResult> {
  const { store } = params
  const provider = params.provider || defaultEnjoyerQuizProvider
  let manifest = structuredClone(params.manifest)
  let artifact = structuredClone(params.artifact)
  let expectedRevision: QuizGenerationExpectedRevision | null = null

  const reloadWinner = async (): Promise<EnjoyerQuizProgressiveResult> => {
    const state = store.loadState
      ? await store.loadState(manifest.identity)
      : { artifact: await store.get(manifest.identity), manifest: await store.getManifest(manifest.identity),
          artifactRevision: null, manifestRevision: null }
    if (!state.artifact || !state.manifest) throw new Error('MANIFEST_MISSING')
    assertEnjoyerQuizState(state.artifact, state.manifest)
    return { status: state.manifest.status, cacheStatus: 'hit', artifact: state.artifact, manifest: state.manifest }
  }

  if (store.loadState && store.compareAndSwapState) {
    const state = await store.loadState(manifest.identity)
    if (!state.artifact || !state.manifest) throw new Error('MANIFEST_MISSING')
    artifact = state.artifact
    manifest = state.manifest
    expectedRevision = { artifactRevision: state.artifactRevision, manifestRevision: state.manifestRevision }
  }

  assertEnjoyerQuizState(artifact, manifest)

  if (manifest.status !== 'generating') {
    return { status: manifest.status, cacheStatus: 'hit', artifact, manifest }
  }
  if (manifest.leaseUntil && Date.parse(manifest.leaseUntil) > Date.now()) {
    return { status: 'generating', cacheStatus: 'hit', artifact, manifest }
  }

  const atomicPlan = manifest.scopePlan
  const retiredSlotIds = new Set(manifest.retiredSlotIds || [])
  const remainingAtomicSlots = atomicPlan
    ? atomicPlan.slots.filter(slot => !retiredSlotIds.has(slot.slotId)
      && !artifact.questions.some(question => question.grounding.slotId === slot.slotId))
    : []
  const remaining = atomicPlan ? remainingAtomicSlots.length : manifest.totalSlots - artifact.questions.length
  if (remaining <= 0) return { status: artifact.meta.status === 'ready' ? 'ready' : 'generating', cacheStatus: 'hit', artifact, manifest }
  manifest = { ...manifest, leaseUntil: new Date(Date.now() + PROGRESSIVE_LEASE_MS).toISOString(),
    updatedAt: new Date().toISOString() }
  if (expectedRevision && store.compareAndSwapState) {
    const claimed = await store.compareAndSwapState(manifest.identity, expectedRevision, artifact, manifest)
    if (!claimed.applied) return reloadWinner()
    expectedRevision = { artifactRevision: claimed.revision, manifestRevision: claimed.revision }
  } else {
    await store.saveManifest(manifest.identity, manifest)
  }
  const beforeCount = artifact.questions.length
  const requiredSlots = atomicPlan ? remainingAtomicSlots.slice(0, MAX_GENERATION_BATCH_SIZE) : undefined
  const requiredTypes = requiredSlots?.map(slot => slot.type)
    || remainingTypePlan(manifest.typePlan, artifact.questions).slice(0, MAX_GENERATION_BATCH_SIZE)
  const chunk = await generateQuestionChunk({ universe: manifest.universe, design: manifest.design,
    config: manifest.config, provider, questions: artifact.questions, requiredTypes, requiredSlots })
  let questions = chunk.questions
  if (atomicPlan) {
    const order = new Map(atomicPlan.slots.map((slot, index) => [slot.slotId, index]))
    questions.sort((a, b) => (order.get(a.grounding.slotId) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(b.grounding.slotId) ?? Number.MAX_SAFE_INTEGER))
  }
  manifest.providerCallsUsed += chunk.providerCalls
  manifest.missingSlotRepairAttempts += chunk.repairAttempts
  mergeRejectionCounts(manifest.rejectionCounts, chunk.rejectionCounts)
  mergeRejectionCounts(manifest.rejectedByType, chunk.rejectedByType)
  mergeRejectionCounts(manifest.repairAttemptsByType, chunk.repairAttemptsByType)
  if (atomicPlan) {
    // When slots exhaust their authoring budget, retire only those failed slot
    // identities, create deterministic replacement slots to maintain the exact
    // requested question count, and continue progressive generation without shrinking the Quiz.
    const acceptedSlotIds = new Set(questions.map(question => question.grounding.slotId))
    const exhaustedSlotIds = new Set(requiredSlots
      ?.filter(slot => !acceptedSlotIds.has(slot.slotId)).map(slot => slot.slotId) || [])
    if (exhaustedSlotIds.size) {
      for (const slotId of exhaustedSlotIds) retiredSlotIds.add(slotId)
      if (retiredSlotIds.size > MAX_SLOT_REPLACEMENTS) {
        manifest.status = 'failed'
        manifest.failureReason = 'INSUFFICIENT_VALID_QUESTIONS'
      } else {
        let replacementFailed = false
        for (const exhaustedSlotId of exhaustedSlotIds) {
          const exhaustedSlot = atomicPlan.slots.find(slot => slot.slotId === exhaustedSlotId)
          const replacement = createReplacementSlot({
            universe: manifest.universe,
            config: manifest.config,
            scopePlan: atomicPlan,
            retiredSlotIds,
            currentQuestions: questions,
            generationId: manifest.generationId,
            avoidTypes: exhaustedSlot ? new Set([exhaustedSlot.type]) : undefined,
          })
          if (replacement) {
            atomicPlan.slots.push(replacement)
          } else {
            replacementFailed = true
            break
          }
        }
        if (replacementFailed) {
          manifest.status = 'failed'
          manifest.failureReason = 'INSUFFICIENT_VALID_QUESTIONS'
        }
      }
      const survivingSlots = atomicPlan.slots.filter(slot => !retiredSlotIds.has(slot.slotId))
      manifest.totalSlots = survivingSlots.length
      manifest.typePlan = survivingSlots.map(slot => slot.type)
      manifest.retiredSlotIds = [...retiredSlotIds]
      manifest.scopePlan = atomicPlan
    }
    if (manifest.totalSlots === 0 || manifest.status === 'failed') {
      manifest.status = 'failed'; manifest.failureReason = 'INSUFFICIENT_VALID_QUESTIONS'
    } else if (questions.length === manifest.totalSlots) {
      manifest.status = 'ready'
      manifest.completionReason = retiredSlotIds.size ? 'requested_limit_reached' : atomicPlan.completionReason
    }
  } else if (questions.length === beforeCount) {
    manifest.status = 'failed'; manifest.failureReason = 'INSUFFICIENT_VALID_QUESTIONS'
  } else if (questions.length === manifest.totalSlots) {
    if (!atomicPlan && manifest.design) {
      const repaired = await repairCoverageByReplacement({ universe: manifest.universe, design: manifest.design,
        config: manifest.config, provider, questions, seen: new Set(questions.map(question => normalize(question.question))) })
      questions = repaired.questions
      manifest.providerCallsUsed += repaired.providerCalls
      manifest.coverageRepairAttempts += repaired.attempts
      manifest.questionsReplacedForCoverage += repaired.replaced
      mergeRejectionCounts(manifest.rejectedByType, repaired.rejectedByType)
      mergeRejectionCounts(manifest.repairAttemptsByType, repaired.repairAttemptsByType)
    }
    manifest.status = 'ready'
    manifest.completionReason = undefined
  }
  if (!atomicPlan) questions.forEach((question, index) => { question.grounding.slotId = `enjoyer-slot:${index + 1}` })
  const coverage = computeEnjoyerQuizCoverage(manifest.universe, questions, manifest.totalSlots,
    manifest.design?.idealQuestionCountForFullCoverage || manifest.universe.targets.length)
  manifest.readyCount = questions.length
  manifest.presentedOrder = questions.map(question => question.grounding.slotId)
  manifest.coverage = coverage
  manifest.leaseUntil = undefined
  manifest.updatedAt = new Date().toISOString()
  const nextArtifact: EnjoyerQuizArtifact = {
    ...artifact,
    meta: { ...artifact.meta, status: manifest.status, llmCallsUsed: manifest.providerCallsUsed,
      repairAttempts: manifest.missingSlotRepairAttempts, coverageRepairAttempts: manifest.coverageRepairAttempts,
      questionsReplacedForCoverage: manifest.questionsReplacedForCoverage,
      finalCoveragePercent: coverage.coveragePercent, finalTopicCoverage: coverage.topicCoverage },
    questions, coverage, completionReason: manifest.completionReason,
    ...(manifest.retiredSlotIds?.length ? { retiredSlotIds: manifest.retiredSlotIds } : {}),
    ...(manifest.scopePlan ? { scopePlan: manifest.scopePlan } : {}),
  }
  assertEnjoyerQuizState(nextArtifact, manifest)
  if (expectedRevision && store.compareAndSwapState) {
    const persisted = await store.compareAndSwapState(manifest.identity, expectedRevision, nextArtifact, manifest)
    if (!persisted.applied) return reloadWinner()
  } else {
    await store.save(manifest.identity, nextArtifact)
    await store.saveManifest(manifest.identity, manifest)
  }
  logTypePlan(manifest, questions)
  logProgressiveState(manifest, questions.length,
    manifest.status === 'generating' ? Math.min(MAX_GENERATION_BATCH_SIZE, manifest.totalSlots - questions.length) : 0,
    beforeCount > 0)
  return { status: manifest.status, cacheStatus: 'miss', artifact: nextArtifact, manifest }
}

export async function startEnjoyerQuizGeneration(params: {
  payload: unknown; selection: SourceSelectionSnapshot; sessionId: string; config: unknown
  design?: EnjoyerAssessmentDesign; scopePlan?: QuizScopePlan
  generationId: string; store: EnjoyerQuizStore; provider?: EnjoyerQuizProvider
}): Promise<EnjoyerQuizProgressiveResult> {
  const universe = buildEnjoyerAssessmentUniverse(params.payload, params.selection)
  const config = normalizeEnjoyerQuizConfig(params.config)
  if (params.design && params.design.fingerprint !== universe.fingerprint) throw new Error('SOURCE_SELECTION_MISMATCH')
  const configFingerprint = quizConfigFingerprint(config)
  const identity = enjoyerQuizArtifactIdentity(params.sessionId, universe.fingerprint, configFingerprint, params.generationId)
  const persisted = params.store.loadState ? await params.store.loadState(identity) : null
  const existingManifest = persisted?.manifest ?? await params.store.getManifest(identity)
  const existingArtifact = persisted?.artifact ?? await params.store.get(identity)
  if (Boolean(existingArtifact) !== Boolean(existingManifest)) throw new Error('MANIFEST_CORRUPT:INCOMPLETE_STATE')
  if (existingArtifact) assertEnjoyerQuizState(existingArtifact, existingManifest, config)
  if (existingManifest && existingArtifact && validateEnjoyerQuizArtifact(existingArtifact, {
    sessionId: params.sessionId, fingerprint: universe.fingerprint, config, generationId: params.generationId,
  })) {
    assertEnjoyerQuizState(existingArtifact, existingManifest, config)
    return { status: existingManifest.status, cacheStatus: 'hit', artifact: existingArtifact, manifest: existingManifest }
  }
  const design = params.scopePlan ? undefined
    : params.design ? restoreHistoricalAssessmentDesign(params.design, universe) || validateAssessmentDesign(params.design, universe)
      : undefined
  if (!params.scopePlan && !design) throw new Error('INVALID_ASSESSMENT_DESIGN')
  if (params.scopePlan && (params.scopePlan.requestedQuestionCount !== config.questionCount
    || params.scopePlan.slots.length < 1 || params.scopePlan.slots.length > config.questionCount
    || params.scopePlan.slots.some(slot => !universe.targets.some(target => target.id === slot.primaryTargetId)
      || !config.questionTypes.includes(slot.type)))) throw new Error('INVALID_SCOPE_PLAN')
  const shared = progressiveInFlight.get(identity)
  if (shared) return { ...(await shared), cacheStatus: 'shared_inflight' }
  const task = (async () => {
    const now = new Date().toISOString()
    const coverage = computeEnjoyerQuizCoverage(universe, [], config.questionCount,
      design?.idealQuestionCountForFullCoverage || universe.targets.length)
    const typePlan = params.scopePlan ? params.scopePlan.slots.map(slot => slot.type) : buildEnjoyerQuizTypePlan(config)
    const totalSlots = typePlan.length
    const manifest: EnjoyerQuizGenerationManifest = { schemaVersion: ENJOYER_QUIZ_SCHEMA_VERSION, identity,
      sessionId: params.sessionId, sourceSelectionFingerprint: universe.fingerprint, configFingerprint,
      generationId: params.generationId, status: 'generating', config, universe,
      ...(design ? { design } : {}), ...(params.scopePlan ? { scopePlan: params.scopePlan } : {}),
      totalSlots, typePlan, readyCount: 0, presentedOrder: [], providerCallsUsed: 0,
      missingSlotRepairAttempts: 0, coverageRepairAttempts: 0, questionsReplacedForCoverage: 0,
      coverage, rejectionCounts: {}, rejectedByType: {}, repairAttemptsByType: {}, redistributedSlots: 0,
      createdAt: now, updatedAt: now }
    const artifact: EnjoyerQuizArtifact = { meta: { schemaVersion: ENJOYER_QUIZ_SCHEMA_VERSION,
      authorityVersion: ENJOYER_QUIZ_AUTHORITY_VERSION, generatorVersion: ENJOYER_QUIZ_GENERATOR_VERSION,
      authoritativeSessionId: params.sessionId, sourceSelectionFingerprint: universe.fingerprint, configFingerprint,
      generationId: params.generationId, generatedAt: now, status: 'generating', llmCallsUsed: 0,
      repairAttempts: 0, coverageRepairAttempts: 0, questionsReplacedForCoverage: 0,
      finalCoveragePercent: 0, finalTopicCoverage: coverage.topicCoverage }, config, questions: [], coverage,
      ...(design ? { design } : {}), ...(params.scopePlan ? { scopePlan: params.scopePlan } : {}) }
    if (params.store.compareAndSwapState && persisted) {
      const created = await params.store.compareAndSwapState(identity, {
        artifactRevision: persisted.artifactRevision,
        manifestRevision: persisted.manifestRevision,
      }, artifact, manifest)
      if (!created.applied) {
        const winner = await params.store.loadState!(identity)
        if (!winner.artifact || !winner.manifest) throw new Error('MANIFEST_MISSING')
        assertEnjoyerQuizState(winner.artifact, winner.manifest, config)
        return { status: winner.manifest.status, cacheStatus: 'hit' as const,
          artifact: winner.artifact, manifest: winner.manifest }
      }
    } else {
      await params.store.save(identity, artifact)
      await params.store.saveManifest(identity, manifest)
    }
    return runEnjoyerProgressiveChunk({ manifest, artifact, store: params.store, provider: params.provider })
  })()
  progressiveInFlight.set(identity, task)
  try { return await task } finally { if (progressiveInFlight.get(identity) === task) progressiveInFlight.delete(identity) }
}

export async function advanceEnjoyerQuizGeneration(params: {
  universe: EnjoyerAssessmentUniverse; sessionId: string; config: unknown; generationId: string
  store: EnjoyerQuizStore; provider?: EnjoyerQuizProvider
}): Promise<EnjoyerQuizProgressiveResult> {
  const config = normalizeEnjoyerQuizConfig(params.config)
  const identity = enjoyerQuizArtifactIdentity(params.sessionId, params.universe.fingerprint,
    quizConfigFingerprint(config), params.generationId)
  const shared = progressiveInFlight.get(identity)
  if (shared) return { ...(await shared), cacheStatus: 'shared_inflight' }
  const task = (async () => {
    const manifest = await params.store.getManifest(identity)
    const artifact = await params.store.get(identity)
    if (!manifest || !artifact || !validateEnjoyerQuizArtifact(artifact, { sessionId: params.sessionId,
      fingerprint: params.universe.fingerprint, config, generationId: params.generationId })) throw new Error('MANIFEST_MISSING')
    if (manifest.sourceSelectionFingerprint !== params.universe.fingerprint
      || manifest.configFingerprint !== quizConfigFingerprint(config)
      || manifest.generationId !== params.generationId
      || manifest.universe.fingerprint !== params.universe.fingerprint) throw new Error('SOURCE_SELECTION_MISMATCH')
    assertEnjoyerQuizState(artifact, manifest, config)
    if (manifest.status !== 'generating') return { status: manifest.status, cacheStatus: 'hit' as const, artifact, manifest }
    if (manifest.leaseUntil && Date.parse(manifest.leaseUntil) > Date.now()) {
      return { status: 'generating' as const, cacheStatus: 'hit' as const, artifact, manifest }
    }
    return runEnjoyerProgressiveChunk({ manifest, artifact, store: params.store, provider: params.provider })
  })()
  progressiveInFlight.set(identity, task)
  try { return await task } finally { if (progressiveInFlight.get(identity) === task) progressiveInFlight.delete(identity) }
}

export class WorkerEnjoyerQuizStore implements EnjoyerQuizStore {
  private materialId(identity: string) { return `enjoyer_quiz:${identity}` }
  private manifestId(identity: string) { return `enjoyer_quiz_manifest:${identity}` }
  constructor(private deps: {
    getMaterialResult?: typeof getMaterialResult
    compareAndSwapQuizGeneration?: typeof compareAndSwapQuizGeneration
  } = {}) {}
  async get(identity: string): Promise<EnjoyerQuizArtifact | null> {
    const result = await (this.deps.getMaterialResult || getMaterialResult)(this.materialId(identity), 'mixto', 'quiz')
    return result?.payload ? canonicalizePersistedEnjoyerQuizArtifact(result.payload as EnjoyerQuizArtifact) : null
  }
  async save(identity: string, artifact: EnjoyerQuizArtifact): Promise<void> {
    await saveMaterialResult({ id: this.materialId(identity), material_id: this.materialId(identity),
      enfoque: 'mixto', result_type: 'quiz', payload: artifact, content_hash: randomUUID() })
  }
  async getManifest(identity: string): Promise<EnjoyerQuizGenerationManifest | null> {
    const result = await (this.deps.getMaterialResult || getMaterialResult)(this.manifestId(identity), 'mixto', 'quiz')
    return result?.payload as EnjoyerQuizGenerationManifest || null
  }
  async saveManifest(identity: string, manifest: EnjoyerQuizGenerationManifest): Promise<void> {
    await saveMaterialResult({ id: this.manifestId(identity), material_id: this.manifestId(identity),
      enfoque: 'mixto', result_type: 'quiz', payload: manifest, content_hash: randomUUID() })
  }
  async loadState(identity: string): Promise<EnjoyerQuizPersistedState> {
    const get = this.deps.getMaterialResult || getMaterialResult
    let last: EnjoyerQuizPersistedState = { artifact: null, manifest: null,
      artifactRevision: null, manifestRevision: null }
    for (let attempt = 0; attempt < 8; attempt++) {
      const [artifactRow, manifestRow] = await Promise.all([
        get(this.materialId(identity), 'mixto', 'quiz'),
        get(this.manifestId(identity), 'mixto', 'quiz'),
      ])
      last = {
        artifact: artifactRow?.payload
          ? canonicalizePersistedEnjoyerQuizArtifact(artifactRow.payload as EnjoyerQuizArtifact) : null,
        manifest: manifestRow?.payload as EnjoyerQuizGenerationManifest || null,
        // Historical rows had random ids and identity-valued hashes. They stay
        // readable, but the first progressive mutation bootstraps stable rows.
        artifactRevision: artifactRow?.id === this.materialId(identity) ? artifactRow.content_hash || null : null,
        manifestRevision: manifestRow?.id === this.manifestId(identity) ? manifestRow.content_hash || null : null,
      }
      const bothAbsent = !last.artifact && !last.manifest
      const legacyPair = Boolean(last.artifact && last.manifest
        && last.artifactRevision === null && last.manifestRevision === null)
      const stablePair = Boolean(last.artifact && last.manifest
        && last.artifactRevision && last.artifactRevision === last.manifestRevision)
      if (bothAbsent || legacyPair || stablePair) return last
    }
    return last
  }
  async compareAndSwapState(identity: string, expected: QuizGenerationExpectedRevision,
    artifact: EnjoyerQuizArtifact, manifest: EnjoyerQuizGenerationManifest): Promise<QuizGenerationCasResult> {
    const revision = randomUUID()
    const cas = this.deps.compareAndSwapQuizGeneration || compareAndSwapQuizGeneration
    const result = await cas({ identity, expectedArtifactRevision: expected.artifactRevision,
      expectedManifestRevision: expected.manifestRevision, revision,
      artifact: artifact as unknown as Record<string, unknown>,
      manifest: manifest as unknown as Record<string, unknown> })
    return { applied: result.applied, revision }
  }
  async find(sessionId: string, fingerprint: string, config: QuizConfig, generationId: string): Promise<EnjoyerQuizArtifact | null> {
    const identity = enjoyerQuizArtifactIdentity(sessionId, fingerprint, quizConfigFingerprint(config), generationId)
    const artifact = await this.get(identity)
    return artifact && validateEnjoyerQuizArtifact(artifact, { sessionId, fingerprint, config, generationId }) ? artifact : null
  }
}

export function canonicalizePersistedEnjoyerQuizArtifact(artifact: EnjoyerQuizArtifact): EnjoyerQuizArtifact {
  if (!artifact || !Array.isArray(artifact.questions)) return artifact
  return { ...artifact, questions: artifact.questions.map(question => canonicalizePersistedFillBlankQuestion(question)) }
}

function designIdentity(fingerprint: string): string {
  return createHash('sha256').update(JSON.stringify({ fingerprint,
    authorityVersion: ENJOYER_QUIZ_AUTHORITY_VERSION, generatorVersion: ENJOYER_QUIZ_GENERATOR_VERSION,
    kind: 'assessment_design' })).digest('hex')
}

/**
 * Fix 5: Restore a historical stored design without applying current creation-time validation.
 * A design that was valid when stored must be restorable even if new constraints now reject it.
 * Only structural decode-level checks run here; no coverage/count validators from creation path.
 */
function restoreHistoricalAssessmentDesign(raw: unknown, universe: EnjoyerAssessmentUniverse): EnjoyerAssessmentDesign | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const ideal = Number(value.idealQuestionCountForFullCoverage)
  if (value.fingerprint !== universe.fingerprint || !Number.isInteger(ideal) || ideal < 1
    || !Array.isArray(value.targetGroups) || !value.targetGroups.length) return null
  const known = new Set(universe.targets.map(target => target.id))
  const groups: EnjoyerAssessmentDesign['targetGroups'] = []
  for (const rawGroup of value.targetGroups) {
    if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) return null
    const group = rawGroup as Record<string, unknown>
    if (typeof group.id !== 'string' || !group.id.trim() || !Array.isArray(group.targetIds)
      || !group.targetIds.length || !group.targetIds.every(id => typeof id === 'string' && known.has(id))) return null
    groups.push({ id: group.id, targetIds: [...group.targetIds], rationale: String(group.rationale || '') })
  }
  const covered = new Set(groups.flatMap(group => group.targetIds))
  if (universe.targets.some(target => !covered.has(target.id))) return null
  // Historical ideal is metadata, not the number of questions authorized for output.
  return { fingerprint: universe.fingerprint, idealQuestionCountForFullCoverage: ideal,
    rationale: String(value.rationale || ''), targetGroups: groups }
}

export async function getOrCreateEnjoyerAssessmentDesign(
  universe: EnjoyerAssessmentUniverse,
  provider: EnjoyerQuizProvider = defaultEnjoyerQuizProvider,
  persistence = { getMaterialResult, saveMaterialResult },
): Promise<{ design: EnjoyerAssessmentDesign; cacheStatus: 'hit' | 'miss'; providerCalls: number }> {
  const identity = designIdentity(universe.fingerprint)
  const materialId = `enjoyer_quiz_design:${identity}`
  const existing = await persistence.getMaterialResult(materialId, 'mixto', 'analysis')
  if (existing?.payload) {
    // Fix 5: First try historical restore — does not apply new creation validators.
    const historical = restoreHistoricalAssessmentDesign(existing.payload, universe)
    if (historical) return { design: historical, cacheStatus: 'hit', providerCalls: 0 }
    // Historical decode failed (structurally corrupt) — fall through to regenerate.
  }
  // Generate a new design. Fix 6: read formatRepairCalls from telemetry to report accurate call count.
  const rawDesign = await provider({ mode: 'design', universe })
  const design = validateAssessmentDesign(rawDesign, universe)
  const formatRepairCalls = Number((rawDesign as any)?.__providerTelemetry?.formatRepairCalls || 0)
  const reportedCalls = Number((rawDesign as { __providerTelemetry?: { providerCalls?: number } })?.__providerTelemetry?.providerCalls)
  const providerCalls = Number.isInteger(reportedCalls) && reportedCalls > 0 ? reportedCalls : 1 + formatRepairCalls
  await persistence.saveMaterialResult({ material_id: materialId, enfoque: 'mixto', result_type: 'analysis',
    payload: design, content_hash: identity })
  return { design, cacheStatus: 'miss', providerCalls }
}

/** Shared fail-closed output and persisted-generation count boundary. Never slices work. */
export function assertEnjoyerQuizState(artifact: EnjoyerQuizArtifact, manifest?: EnjoyerQuizGenerationManifest | null,
  expectedConfig: QuizConfig = artifact.config): void {
  const fail = (): never => { throw new Error('MANIFEST_CORRUPT:INCONSISTENT_QUESTION_COUNT') }
  let config: QuizConfig
  try { config = normalizeEnjoyerQuizConfig(expectedConfig) } catch { return fail() }
  const count = config.questionCount
  const fingerprint = quizConfigFingerprint(config)
  const artifactHasScope = Boolean(artifact.scopePlan)
  const manifestHasScope = Boolean(manifest?.scopePlan)
  if (manifest && artifactHasScope !== manifestHasScope) fail()
  const progressive = artifactHasScope || manifestHasScope
  const scopePlan = artifact.scopePlan || manifest?.scopePlan
  if (manifest && progressive && JSON.stringify(artifact.scopePlan) !== JSON.stringify(manifest.scopePlan)) fail()
  if (manifest && JSON.stringify(artifact.retiredSlotIds || []) !== JSON.stringify(manifest.retiredSlotIds || [])) fail()
  const retiredSlotIds = new Set(artifact.retiredSlotIds || manifest?.retiredSlotIds || [])
  const activeScopeSlots = scopePlan?.slots.filter(slot => !retiredSlotIds.has(slot.slotId)) || []
  const expectedSlots = manifest?.totalSlots ?? (progressive ? activeScopeSlots.length : count)
  if (!Array.isArray(artifact.questions) || artifact.questions.length > count
    || artifact.config.questionCount !== count || quizConfigFingerprint(artifact.config) !== fingerprint
    || artifact.meta.configFingerprint !== fingerprint
    || expectedSlots < 1 || expectedSlots > count
    || (artifact.meta.status === 'ready' && artifact.questions.length !== expectedSlots)) fail()
  if (progressive) {
    if (!scopePlan || scopePlan.version !== 1 || scopePlan.requestedQuestionCount !== count
      || !Array.isArray(scopePlan.slots) || scopePlan.slots.length < expectedSlots
      || scopePlan.slots.length > count + MAX_SLOT_REPLACEMENTS
      || new Set(scopePlan.slots.map(slot => slot.slotId)).size !== scopePlan.slots.length
      || scopePlan.slots.some(slot => !slot.slotId || !slot.primaryTargetId || !config.questionTypes.includes(slot.type))
      || retiredSlotIds.size !== (artifact.retiredSlotIds || manifest?.retiredSlotIds || []).length
      || [...retiredSlotIds].some(slotId => !scopePlan.slots.some(slot => slot.slotId === slotId))
      || activeScopeSlots.length !== expectedSlots) fail()
    const slotById = new Map(scopePlan.slots.map(slot => [slot.slotId, slot]))
    if (artifact.questions.some(question => {
      const slot = slotById.get(question.grounding.slotId)
      return !slot || retiredSlotIds.has(slot.slotId) || question.type !== slot.type
        || question.grounding.assessmentTargetIds.length !== 1
        || question.grounding.assessmentTargetIds[0] !== slot.primaryTargetId
    })) fail()
    if (manifest) {
      const authorized = new Set(manifest.universe.targets.map(target => target.id))
      if (scopePlan.universeFingerprint.length !== 64
        || scopePlan.slots.some(slot => !authorized.has(slot.primaryTargetId))) fail()
    }
  }
  if (manifest && ((!progressive && manifest.totalSlots !== count) || manifest.config.questionCount !== count
    || quizConfigFingerprint(manifest.config) !== fingerprint || manifest.configFingerprint !== fingerprint
    || !Array.isArray(manifest.typePlan) || manifest.typePlan.length !== manifest.totalSlots
    || manifest.typePlan.some(type => !config.questionTypes.includes(type))
    || (progressive && manifest.typePlan.some((type, index) => type !== activeScopeSlots[index]?.type))
    || manifest.readyCount !== artifact.questions.length
    || !Array.isArray(manifest.presentedOrder) || manifest.presentedOrder.length !== artifact.questions.length
    || manifest.presentedOrder.some((slotId, index) => slotId !== artifact.questions[index]?.grounding.slotId)
    || manifest.status !== artifact.meta.status
    || artifact.completionReason !== manifest.completionReason
    || (manifest.status === 'ready' && artifact.questions.length !== expectedSlots))) fail()
}

export function validateEnjoyerQuizArtifact(artifact: EnjoyerQuizArtifact, expected: {
  sessionId: string; fingerprint: string; config: QuizConfig; generationId: string
}): boolean {
  try { assertEnjoyerQuizState(artifact, undefined, expected.config) } catch { return false }
  return artifact?.meta?.schemaVersion === ENJOYER_QUIZ_SCHEMA_VERSION
    && artifact.meta.authorityVersion === ENJOYER_QUIZ_AUTHORITY_VERSION
    && artifact.meta.generatorVersion === ENJOYER_QUIZ_GENERATOR_VERSION
    && artifact.meta.authoritativeSessionId === expected.sessionId
    && artifact.meta.sourceSelectionFingerprint === expected.fingerprint
    && artifact.meta.configFingerprint === quizConfigFingerprint(expected.config)
    && artifact.meta.generationId === expected.generationId
    && artifact.questions.length <= expected.config.questionCount
    && (artifact.meta.status !== 'ready' || artifact.questions.length === (artifact.scopePlan
      ? artifact.scopePlan.slots.length - (artifact.retiredSlotIds?.length || 0) : expected.config.questionCount))
    && artifact.questions.every(question => question.grounding.sourceSelectionFingerprint === expected.fingerprint)
}
