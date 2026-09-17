import { generateValidatedLegacyJson } from '../../ai/legacyRouteGeneration'
import type { QuizQuestionType } from '../../types/quiz'
import type { MaterialBrain } from '../types'
import type {
  GroundedQuizQuestion, PlannedQuizQuestion, QuizGenerationTerminalStatus,
  QuizPlan, QuizRejectionDiagnostic,
} from './types'
import {
  allocateQuizTypeTargets, compareQuizCandidateNovelty, quizAssessmentSemanticIdentity,
  quizKnowledgeTargetId, quizUnitRank,
} from './planner'
import {
  QUIZ_DEFAULT_BATCH_SIZE,
  computeQuizProviderBudget,
} from './types'
import { normalizeQuizText, plannedContext, validateGeneratedQuiz, type QuizValidationContext } from './validate'

export type GenerateQuizBatchFn = (
  plans: ReturnType<typeof plannedContext>[],
  language?: string,
  attemptControl?: { beforeProviderAttempt: () => void },
) => Promise<unknown[]>

const TYPE_SCHEMAS: Record<string, Record<string, unknown>> = {
  multiple_choice: { planId: 'PLAN_ID', question: '...', explanation: '...', supportingText: 'optional debug context', options: ['distractor 1', 'distractor 2', 'distractor 3'] },
  multi_select: { planId: 'PLAN_ID', question: '...', explanation: '...', supportingText: 'optional debug context', options: ['distractor 1', 'distractor 2'] },
  true_false: { planId: 'PLAN_ID', question: 'provided target statement', explanation: '...', supportingText: 'optional debug context' },
  fill_blank: { planId: 'PLAN_ID', question: '... ___ ...', explanation: '...', supportingText: 'optional debug context', wordBank: ['distractor 1', 'distractor 2', 'distractor 3'] },
  matching: { planId: 'PLAN_ID', question: '...', explanation: '...', supportingText: 'optional debug context' },
  short_answer: { planId: 'PLAN_ID', question: '...', explanation: '...', supportingText: 'optional debug context' },
}

export function buildQuizBatchPrompt(plans: ReturnType<typeof plannedContext>[], language = 'es'): string {
  const schemas = [...new Set(plans.map(plan => plan.requiredType))]
    .map(type => TYPE_SCHEMAS[type]).filter(Boolean)
  return `Generate exactly one grounded quiz question for every plan below.
Use ONLY the supplied units and relations. Return one JSON object shaped {"questions":[...]}, with no markdown or prose.
Preserve planId exactly so each surface response can be correlated with its plan. Use the corresponding schema example below.
Follow assessmentIntent and transformationVariant. Questions with different variants must test the supplied truth from genuinely different directions, not paraphrase the same prompt.
Follow cognitiveIntent exactly: recall means a direct question about one explicit fact; discriminate means distinguishing or relating two nearby grounded concepts; integrate means combining or comparing multiple supplied grounded facts or relations without external knowledge.
recentKnowledgeTargetsToAvoid is a soft variety hint only: avoid merely reformulating those recent targets when reasonable, but never change type, answer authority, or grounding to do so.
The required type, difficulty, ID, correct answer, pairs, and selections are ALREADY DETERMINED by the plan and will be stamped authoritatively after your response. Your job is only to write the question text, explanation, and optional distractor candidates around them; do not invent or rediscover the correct answer.
supportingText is optional explanatory/debug context and may paraphrase the source.
For multiple_choice and multi_select, options contains distractor candidates only. For fill_blank, wordBank contains distractor candidates only. Matching pairs, boolean answers, accepted answers, canonical correct options, and final indices are added downstream from answerTarget.
Distractor candidates must be unique, plausible, and not also correct. Do not invent citations, pages, facts, or quotes.
Language: ${language}.
CANONICAL SCHEMAS:
${JSON.stringify(schemas)}
PLANS:
${JSON.stringify(plans)}`
}

export function normalizeQuizBatchResponse(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value && typeof value === 'object' && Array.isArray((value as { questions?: unknown }).questions)
    ? (value as { questions: unknown[] }).questions
    : []
}

export interface BatchStructuralExpectation {
  planId: string
  requiredType: QuizQuestionType
}
export interface BatchStructuralResult {
  valid: boolean; errors: string[]; itemCount: number; expectedItemCount: number
}

function hasNonEmptyString(v: unknown): boolean { return typeof v === 'string' && v.trim().length > 0 }
function basicShapeErrors(item: any, _requiredType: QuizQuestionType): string[] {
  const errors: string[] = []
  if (!item || typeof item !== 'object') return ['not_object']
  if (!hasNonEmptyString(item.question)) errors.push('question_missing')
  if (!hasNonEmptyString(item.explanation)) errors.push('explanation_missing')
  return errors
}

function uniqueSurfaceValues(values: unknown[], excluded: string[] = []): string[] {
  const seen = new Set(excluded.map(normalizeQuizText).filter(Boolean))
  const result: string[] = []
  for (const value of values) {
    const text = String(value || '').trim()
    const normalized = normalizeQuizText(text)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(text)
  }
  return result
}

function fillDistractors(values: string[], required: number, excluded: string[]): string[] {
  const result = uniqueSurfaceValues(values, excluded)
  let sequence = 1
  while (result.length < required) {
    const fallback = `Alternativa incorrecta ${sequence++}`
    if (!new Set([...excluded, ...result].map(normalizeQuizText)).has(normalizeQuizText(fallback))) result.push(fallback)
  }
  return result.slice(0, required)
}

/** Reassert planner-owned identity and academic answers after provider surface generation. */
export function stampAuthoritativeQuizOutput(
  planned: PlannedQuizQuestion[], providerItems: unknown[],
): unknown[] {
  const remaining = new Map(planned.map(item => [item.id, item]))
  return providerItems.slice(0, planned.length).flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [raw]
    const providerPlanId = String((raw as any).planId || '')
    const target = remaining.get(providerPlanId) || planned.find((item, position) => position >= index && remaining.has(item.id))
      || [...remaining.values()][0]
    if (!target) return []
    remaining.delete(target.id)
    const item: any = {
      ...(raw as Record<string, unknown>),
      planId: target.id,
      id: `quiz-question:${target.id}`,
      type: target.questionType,
      difficulty: target.difficulty,
    }
    const answerTarget = target.answerTarget
    if (target.questionType === 'multiple_choice' && answerTarget.kind === 'single_text') {
      const canonical = String(answerTarget.canonicalValue || '').trim()
      const distractors = fillDistractors(Array.isArray(item.options) ? item.options : [], 3, [canonical])
      item.options = [canonical, ...distractors]
      item.correctAnswer = 0
    } else if (target.questionType === 'multi_select' && answerTarget.kind === 'multi_text') {
      const canonicalValues = (answerTarget.canonicalValues || []).map(String)
      const uniqueCanonical = uniqueSurfaceValues(canonicalValues)
      if (uniqueCanonical.length !== canonicalValues.length) {
        // Preserve the invalid canonical collision so the strict validator rejects it.
        item.options = canonicalValues
        item.correctAnswers = canonicalValues.map((_, i) => i)
      } else {
        const targetOptionCount = Math.min(5, Math.max(3, canonicalValues.length + 1))
        const distractors = fillDistractors(
          Array.isArray(item.options) ? item.options : [],
          targetOptionCount - canonicalValues.length,
          canonicalValues,
        )
        item.options = [...canonicalValues, ...distractors]
        item.correctAnswers = canonicalValues.map((_, i) => i)
      }
    } else if (target.questionType === 'true_false' && answerTarget.kind === 'boolean') {
      item.correctAnswer = answerTarget.canonicalValue === 'true'
    } else if (target.questionType === 'fill_blank' && answerTarget.kind === 'single_text') {
      const canonical = String(answerTarget.canonicalValue || '').trim()
      item.answer = canonical
      item.wordBank = [canonical, ...fillDistractors(
        Array.isArray(item.wordBank) ? item.wordBank : [], 3, [canonical],
      )]
    } else if (target.questionType === 'matching' && answerTarget.kind === 'pairs') {
      item.pairs = (answerTarget.pairTargets || []).map(pair => ({
        left: pair.leftCanonical, right: pair.rightCanonical,
      }))
    } else if (target.questionType === 'short_answer' && answerTarget.kind === 'single_text') {
      item.acceptedAnswers = uniqueSurfaceValues([
        answerTarget.canonicalValue, ...(answerTarget.acceptedSurfaceForms || []),
      ])
    }
    return [item]
  })
}
export function validateBatchStructure(value: unknown, expected: BatchStructuralExpectation[]): BatchStructuralResult {
  const items = normalizeQuizBatchResponse(value)
  const errors: string[] = []
  const expectedByPlanId = new Map(expected.map(e => [e.planId, e.requiredType]))
  if (items.length === 0) errors.push('empty_batch')
  if (items.length !== expected.length) errors.push(`item_count:${items.length}:${expected.length}`)
  for (const [index, item] of items.entries()) {
    const planId = String((item as any)?.planId || '')
    const expectation = expectedByPlanId.get(planId) || expected[index]
    if (!expectation) continue
    const requiredType = typeof expectation === 'string' ? expectation : expectation.requiredType
    const diagnosticId = typeof expectation === 'string' ? planId : expectation.planId
    for (const err of basicShapeErrors(item, requiredType)) errors.push(`shape:${diagnosticId}:${err}`)
  }
  return { valid: errors.length === 0, errors, itemCount: items.length, expectedItemCount: expected.length }
}

export async function generateQuizBatch(
  plans: ReturnType<typeof plannedContext>[],
  language = 'es',
  attemptControl?: { beforeProviderAttempt: () => void },
): Promise<unknown[]> {
  const prompt = buildQuizBatchPrompt(plans, language)
  const expectation: BatchStructuralExpectation[] = plans.map(plan => ({
    planId: plan.planId, requiredType: plan.requiredType as QuizQuestionType,
  }))
  return generateValidatedLegacyJson<unknown[]>({
    taskType: 'evaluation_question',
    prompt,
    maxTokens: Math.min(5200, 1200 + plans.length * 650),
    normalize: normalizeQuizBatchResponse,
    validate: value => {
      const structural = validateBatchStructure(value, expectation)
      return {
        valid: structural.valid,
        errors: structural.valid ? [] : structural.errors.map(err => `STRUCTURAL_VALIDATION_FAILED:quiz_batch:${err}`),
      }
    },
    telemetryContext: { route: 'quiz_v2', phase: 'question_generation', expectedItemCount: plans.length },
    failurePath: 'single_repair',
    beforeProviderAttempt: () => attemptControl?.beforeProviderAttempt(),
  })
}

export interface QuizGenerationOutcome {
  status: QuizGenerationTerminalStatus
  questions: GroundedQuizQuestion[]
  llmCallsUsed: number
  rawQuestionsCount: number
  errors: string[]
  diagnostics: QuizRejectionDiagnostic[]
  initialAccepted: number
  initialGenerated: number
  replacementAttempts: number
  replacementBatches: number
  providerAttemptsTotal: number
  providerAttemptsBudget: number
  providerError?: string
}

interface RunBatchResult {
  diagnostics: QuizRejectionDiagnostic[]
  rawCount: number
  llmCalls: number
  acceptedBySlot: Map<string, GroundedQuizQuestion>
  batchPlanIdsSent: string[][]
  providerError?: string
  providerAttemptsMade: number
  providerBudgetExhausted: boolean
}

async function runBatch(
  brain: MaterialBrain,
  plan: QuizPlan,
  planned: PlannedQuizQuestion[],
  generateBatch: GenerateQuizBatchFn,
  batchSize: number,
  language: string | undefined,
  dedupeContext: QuizValidationContext,
  attemptTracker: { remainingBudget: number; attemptsMade: number },
): Promise<RunBatchResult> {
  const raw: unknown[] = []
  let llmCalls = 0
  const batchPlanIdsSent: string[][] = []
  let providerError: string | undefined
  const attemptsBefore = attemptTracker.attemptsMade
  let providerBudgetExhausted = false
  try {
    for (let index = 0; index < planned.length; index += batchSize) {
      const batchPlanned = planned.slice(index, index + batchSize)
      const batch = batchPlanned.map(item => plannedContext(brain, item))
      batchPlanIdsSent.push(batch.map(b => b.planId))
      const consumeAttempt = () => {
          if (attemptTracker.remainingBudget <= 0) throw new Error('QUIZ_PROVIDER_BUDGET_EXHAUSTED')
          attemptTracker.remainingBudget -= 1
          attemptTracker.attemptsMade += 1
      }
      // Injected deterministic generators represent one provider boundary.
      // Production generation reports every normal/repair attempt through the hook.
      if (generateBatch !== generateQuizBatch) consumeAttempt()
      const result = await generateBatch(batch, language,
        generateBatch === generateQuizBatch ? { beforeProviderAttempt: consumeAttempt } : undefined)
      llmCalls += 1
      raw.push(...stampAuthoritativeQuizOutput(batchPlanned, result))
    }
  } catch (err: any) {
    providerError = String(err?.message || err || 'provider_error')
    providerBudgetExhausted = providerError.includes('QUIZ_PROVIDER_BUDGET_EXHAUSTED')
  }
  const ephemeralPlan: QuizPlan = { ...plan, plannedQuestions: planned }
  const validated = validateGeneratedQuiz(brain, ephemeralPlan, raw, dedupeContext)
  const acceptedBySlot = new Map<string, GroundedQuizQuestion>()
  for (const q of validated.questions) {
    const slotId = (q.grounding as any).slotId as string | undefined
    if (slotId) acceptedBySlot.set(slotId, q)
  }
  return {
    diagnostics: validated.diagnostics,
    rawCount: raw.length,
    llmCalls,
    acceptedBySlot,
    batchPlanIdsSent,
    providerError,
    providerAttemptsMade: attemptTracker.attemptsMade - attemptsBefore,
    providerBudgetExhausted,
  }
}

export async function generateQuizFromPlan(
  brain: MaterialBrain,
  plan: QuizPlan,
  options: { generateBatch?: GenerateQuizBatchFn; batchSize?: number; providerBudget?: number;
    dedupeContext?: QuizValidationContext } = {},
): Promise<QuizGenerationOutcome> {
  const generateBatch = options.generateBatch || generateQuizBatch
  const batchSize = Math.max(1, Math.min(options.batchSize || QUIZ_DEFAULT_BATCH_SIZE, 12))
  const providerAttemptsBudget = Math.max(
    1,
    options.providerBudget ?? computeQuizProviderBudget(plan.config.questionCount, batchSize),
  )
  const attemptTracker = { remainingBudget: providerAttemptsBudget, attemptsMade: 0 }
  const language = plan.config.language
  const dedupe: QuizValidationContext = options.dedupeContext || {
    seenIds: new Set<string>(), seenQuestions: new Map<string, string>(), seenIntent: new Map<string, string>(),
    seenAssessmentIdentity: new Map<string, string>(),
  }
  const requested = plan.plannedQuestions.length
  const acceptedBySlot = new Map<string, GroundedQuizQuestion>()
  const allDiagnostics: QuizRejectionDiagnostic[] = []
  const errorLabels: string[] = []
  let llmCallsUsed = 0
  let rawTotal = 0
  let replacementAttempts = 0
  let replacementBatches = 0
  let providerAttemptsTotal = 0
  let lastProviderError: string | undefined
  let providerHardFailure = false

  const attemptedCandidateIds = new Set(plan.plannedQuestions.map(question => question.candidateId))
  const globallyRetiredCandidateIds = new Set<string>()
  const historyCounts = new Map(Object.entries(plan.noveltyContext?.historyCounts || {}))
  const assessmentHistoryCounts = new Map(Object.entries(plan.noveltyContext?.assessmentHistoryCounts || {}))
  const repeatDepthByKnowledgeTarget = new Map<string, number>()
  const repeatDepthByAssessmentIdentity = new Map<string, number>()
  const repeatDepthByUnit = new Map<string, number>()
  const repeatDepthByCanonicalSubject = new Map<string, number>()
  const bucketUsage = new Map<string, number>()
  const ranks = new Map(brain.units.map(unit => [unit.id, quizUnitRank(unit)]))
  const canonicalSubjectByUnit = new Map(brain.units.map(unit => [unit.id, unit.identity.canonicalSubject]))
  const recordedAcceptedIds = new Set<string>()
  const recordAcceptedQuestion = (question: GroundedQuizQuestion) => {
    if (recordedAcceptedIds.has(question.id)) return
    recordedAcceptedIds.add(question.id)
    const knowledgeTargetId = quizKnowledgeTargetId(
      question.grounding.sourceUnitIds, question.grounding.sourceRelationIds,
    )
    repeatDepthByKnowledgeTarget.set(
      knowledgeTargetId, (repeatDepthByKnowledgeTarget.get(knowledgeTargetId) || 0) + 1,
    )
    const assessmentIdentity = question.grounding.assessmentSemanticIdentity || ''
    if (assessmentIdentity) repeatDepthByAssessmentIdentity.set(
      assessmentIdentity, (repeatDepthByAssessmentIdentity.get(assessmentIdentity) || 0) + 1,
    )
    for (const unitId of question.grounding.sourceUnitIds) {
      repeatDepthByUnit.set(unitId, (repeatDepthByUnit.get(unitId) || 0) + 1)
      const subject = canonicalSubjectByUnit.get(unitId) || ''
      repeatDepthByCanonicalSubject.set(subject, (repeatDepthByCanonicalSubject.get(subject) || 0) + 1)
    }
    const key = `${question.grounding.evidence[0]?.materialId || ''}:${question.grounding.evidence[0]?.page || 0}`
    bucketUsage.set(key, (bucketUsage.get(key) || 0) + 1)
  }

  const markRetired = (diagnostics: QuizRejectionDiagnostic[]) => {
    for (const d of diagnostics) {
      if (d.candidateId) globallyRetiredCandidateIds.add(d.candidateId)
    }
  }

  // Initial batch.
  const initial = await runBatch(brain, plan, plan.plannedQuestions, generateBatch, batchSize, language, dedupe, attemptTracker)
  llmCallsUsed += initial.llmCalls
  rawTotal += initial.rawCount
  providerAttemptsTotal += initial.providerAttemptsMade
  for (const [slotId, q] of initial.acceptedBySlot) acceptedBySlot.set(slotId, q)
  for (const q of initial.acceptedBySlot.values()) recordAcceptedQuestion(q)
  allDiagnostics.push(...initial.diagnostics)
  errorLabels.push(...initial.diagnostics.map(d => `${d.reason}:${d.planId}`))
  markRetired(initial.diagnostics)
  if (initial.providerError) {
    lastProviderError = initial.providerError
    // Technical failure with ZERO accepted questions in the initial pass →
    // treat as provider generation failure (Blocker 5). Do NOT retire academic
    // candidates. Do NOT swap to alternates as if content were invalid.
    if (!initial.providerBudgetExhausted) providerHardFailure = true
  }
  const initialAccepted = acceptedBySlot.size
  const initialGenerated = initial.rawCount

  // Recovery loop — ONLY runs when the initial pass had academic rejections
  // (i.e. missing slots that are still expected to be recoverable). If the
  // initial pass hard-failed at provider level, we skip recovery.
  if (!providerHardFailure) {
    let round = 0
    while (true) {
      const missingCount = requested - acceptedBySlot.size
      if (missingCount <= 0) break
      if (attemptTracker.remainingBudget <= 0) break

      const replacementPlans: PlannedQuizQuestion[] = []
      const inRoundIntents = new Set<string>()
      const inRoundAssessmentIdentities = new Set<string>()

      const acceptedTypeCounts = new Map<QuizQuestionType, number>()
      for (const question of acceptedBySlot.values()) {
        acceptedTypeCounts.set(question.type, (acceptedTypeCounts.get(question.type) || 0) + 1)
      }
      const capacity = new Map<QuizQuestionType, number>()
      for (const type of plan.config.questionTypes) {
        capacity.set(type, plan.globalCandidatePool.filter(candidate => candidate.questionType === type).length)
      }
      const targets = allocateQuizTypeTargets(requested, plan.config.questionTypes, capacity)
      const rankedCandidates = plan.globalCandidatePool
        .filter(candidate => !attemptedCandidateIds.has(candidate.candidateId))
        .filter(candidate => !globallyRetiredCandidateIds.has(candidate.candidateId))
        .filter(candidate => !dedupe.seenIntent.has(candidate.intent))
        .sort((a, b) => {
          const deficitA = (targets.get(a.questionType) || 0) - (acceptedTypeCounts.get(a.questionType) || 0)
          const deficitB = (targets.get(b.questionType) || 0) - (acceptedTypeCounts.get(b.questionType) || 0)
          return deficitB - deficitA || compareQuizCandidateNovelty(a, b, {
            historyCounts, assessmentHistoryCounts,
            generationId: plan.noveltyContext?.generationId,
            repeatDepthByKnowledgeTarget, repeatDepthByAssessmentIdentity,
            repeatDepthByUnit,
            repeatDepthByCanonicalSubject,
            bucketUsage,
            ranks,
            canonicalSubjectByUnit,
            selectedTypes: plan.config.questionTypes,
          })
        })
      const missingSlots = plan.slots.filter(slot => !acceptedBySlot.has(slot.slotId))
      const remainingCandidates = [...rankedCandidates]
      for (const slot of missingSlots.slice(0, Math.min(missingCount, batchSize))) {
        const sameTypeIndex = remainingCandidates.findIndex(candidate =>
          candidate.questionType === slot.questionType && !inRoundIntents.has(candidate.intent)
          && !inRoundAssessmentIdentities.has(candidate.assessmentSemanticIdentity))
        const fallbackIndex = remainingCandidates.findIndex(candidate => !inRoundIntents.has(candidate.intent)
          && !inRoundAssessmentIdentities.has(candidate.assessmentSemanticIdentity))
        const scarceSameTypeIndex = remainingCandidates.findIndex(candidate =>
          candidate.questionType === slot.questionType && !inRoundIntents.has(candidate.intent))
        const scarceFallbackIndex = remainingCandidates.findIndex(candidate => !inRoundIntents.has(candidate.intent))
        const candidateIndex = sameTypeIndex >= 0 ? sameTypeIndex
          : fallbackIndex >= 0 ? fallbackIndex
            : scarceSameTypeIndex >= 0 ? scarceSameTypeIndex : scarceFallbackIndex
        if (candidateIndex < 0) continue
        const [next] = remainingCandidates.splice(candidateIndex, 1)
        attemptedCandidateIds.add(next.candidateId)
        inRoundIntents.add(next.intent)
        inRoundAssessmentIdentities.add(next.assessmentSemanticIdentity)
        replacementAttempts += 1
        replacementPlans.push({
          id: `quiz-plan:r${round + 1}:${slot.order + 1}:${next.candidateId}`,
          slotId: slot.slotId,
          candidateId: next.candidateId,
          order: slot.order,
          intent: next.intent,
          assessmentIntent: next.assessmentIntent,
          cognitiveIntent: next.cognitiveIntent,
          assessmentSemanticIdentity: next.assessmentSemanticIdentity,
          ...(next.recentKnowledgeTargetsToAvoid ? {
            recentKnowledgeTargetsToAvoid: [...next.recentKnowledgeTargetsToAvoid],
          } : {}),
          transformationVariant: next.transformationVariant,
          questionType: next.questionType,
          difficulty: next.difficulty,
          sourceUnitIds: next.sourceUnitIds,
          sourceRelationIds: next.sourceRelationIds,
          sourceMaterialId: next.sourceMaterialId,
          sourcePage: next.sourcePage,
          unitKind: next.unitKind,
          evidence: next.evidence,
          evidenceLinks: next.evidenceLinks,
          answerTarget: next.answerTarget,
          groundingTarget: next.groundingTarget,
        })
      }
      if (!replacementPlans.length) break
      dedupe.eligibleAssessmentIdentities = new Set(
        replacementPlans.map(question => question.assessmentSemanticIdentity),
      )
      replacementBatches += 1
      const rec = await runBatch(brain, plan, replacementPlans, generateBatch, batchSize, language, dedupe, attemptTracker)
      llmCallsUsed += rec.llmCalls
      rawTotal += rec.rawCount
      providerAttemptsTotal += rec.providerAttemptsMade
      for (const [slotId, q] of rec.acceptedBySlot) if (!acceptedBySlot.has(slotId)) acceptedBySlot.set(slotId, q)
      for (const q of rec.acceptedBySlot.values()) recordAcceptedQuestion(q)
      allDiagnostics.push(...rec.diagnostics)
      errorLabels.push(...rec.diagnostics.map(d => `${d.reason}:${d.planId}`))
      markRetired(rec.diagnostics)
      if (rec.providerError) {
        lastProviderError = rec.providerError
        // Recovery-round provider failure with no accepted questions in this
        // round is a technical failure; break out and classify below.
        if (!rec.providerBudgetExhausted) providerHardFailure = true
        break
      }
      round += 1
    }
  }

  const orderedQuestions: GroundedQuizQuestion[] = []
  for (const slot of plan.slots) {
    const q = acceptedBySlot.get(slot.slotId)
    if (q) orderedQuestions.push(q)
  }

  let status: QuizGenerationTerminalStatus = 'ready'
  if (orderedQuestions.length < requested) {
    if (providerHardFailure) status = 'provider_generation_failed'
    else {
      const hasUnusedLegitimate = plan.globalCandidatePool.some(candidate =>
        !attemptedCandidateIds.has(candidate.candidateId)
        && !globallyRetiredCandidateIds.has(candidate.candidateId)
        && !dedupe.seenIntent.has(candidate.intent))
      const budgetReached = attemptTracker.remainingBudget <= 0
      status = (hasUnusedLegitimate && budgetReached)
        ? 'recovery_budget_exhausted'
        : 'insufficient_valid_questions'
    }
  }

  return {
    status,
    questions: orderedQuestions,
    llmCallsUsed,
    rawQuestionsCount: rawTotal,
    errors: errorLabels,
    diagnostics: allDiagnostics,
    initialAccepted,
    initialGenerated,
    replacementAttempts,
    replacementBatches,
    providerAttemptsTotal,
    providerAttemptsBudget,
    ...(lastProviderError ? { providerError: lastProviderError } : {}),
  }
}

export interface QuizChunkState {
  acceptedBySlot: Map<string, GroundedQuizQuestion>
  attemptedCandidateIds: Set<string>
  globallyRetiredCandidateIds: Set<string>
  dedupe: QuizValidationContext
  historyCounts: Map<string, number>
  assessmentHistoryCounts: Map<string, number>
  providerAttemptsBudgetRemaining: number
}

/**
 * Durable orchestration boundary for progressive generation. The proven full
 * generator remains the single recovery/authority implementation; this scopes
 * it to frozen slots and removes candidates already consumed by prior chunks.
 */
export async function generateQuizChunk(
  brain: MaterialBrain,
  plan: QuizPlan,
  state: QuizChunkState,
  targetSlotIds: string[],
  generateBatch: GenerateQuizBatchFn = generateQuizBatch,
  batchSize = QUIZ_DEFAULT_BATCH_SIZE,
  language = plan.config.language,
) {
  const targetSet = new Set(targetSlotIds)
  const existingAssessmentIdentities = new Set(
    [...state.acceptedBySlot.values()].map(q => q.grounding.assessmentSemanticIdentity || '').filter(Boolean),
  )
  const scopedPlanned = plan.plannedQuestions.filter(q => targetSet.has(q.slotId))
  const scopedPlan: QuizPlan = {
    ...plan,
    config: { ...plan.config, questionCount: scopedPlanned.length },
    plannedQuestions: scopedPlanned,
    slots: plan.slots.filter(slot => targetSet.has(slot.slotId)),
    candidatePoolBySlot: Object.fromEntries(targetSlotIds.map(slotId => [slotId,
      (plan.candidatePoolBySlot[slotId] || []).filter(candidate =>
        !state.attemptedCandidateIds.has(candidate.candidateId)
        && !state.globallyRetiredCandidateIds.has(candidate.candidateId)
        && !existingAssessmentIdentities.has(candidate.assessmentSemanticIdentity))])),
    globalCandidatePool: plan.globalCandidatePool.filter(candidate =>
      !state.attemptedCandidateIds.has(candidate.candidateId)
      && !state.globallyRetiredCandidateIds.has(candidate.candidateId)
      && !existingAssessmentIdentities.has(candidate.assessmentSemanticIdentity)),
  }
  // Primary candidates for these pending slots are legitimate first attempts.
  for (const question of scopedPlanned) state.attemptedCandidateIds.delete(question.candidateId)
  const outcome = await generateQuizFromPlan(brain, scopedPlan, {
    generateBatch, batchSize,
    providerBudget: Math.max(1, state.providerAttemptsBudgetRemaining),
    dedupeContext: state.dedupe,
  })
  const acceptedBySlot = new Map<string, GroundedQuizQuestion>()
  for (const question of outcome.questions) {
    const slotId = question.grounding.slotId
    if (slotId) acceptedBySlot.set(slotId, question)
  }
  const retiredCandidateIds = outcome.diagnostics.map(item => item.candidateId).filter((id): id is string => Boolean(id))
  return {
    acceptedBySlot,
    diagnostics: outcome.diagnostics,
    llmCallsUsed: outcome.llmCallsUsed,
    providerAttemptsUsed: outcome.providerAttemptsTotal,
    providerError: outcome.providerError,
    providerHardFailure: outcome.status === 'provider_generation_failed',
    retiredCandidateIds,
    terminalStatus: outcome.status,
    initialGenerated: outcome.initialGenerated,
    initialAccepted: outcome.initialAccepted,
    replacementAttempts: outcome.replacementAttempts,
    replacementBatches: outcome.replacementBatches,
  }
}
