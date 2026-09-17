import { validateSourceEvidence } from '../../materials/sourceEvidence'
import type { QuizQuestion, QuizQuestionType } from '../../types/quiz'
import type { KnowledgeUnit, MaterialBrain } from '../types'
import type {
  AnswerTarget, EvidenceBackedAssertion, GroundedQuizQuestion, PlannedQuizQuestion, QuizPlan,
  QuizRejectionDiagnostic, SupportCheckMode, TrueFalseValueClass,
} from './types'
import { verifyEvidenceLink } from './grounding'

export function normalizeQuizText(value: unknown): string {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

function integer(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

function unitText(unit: KnowledgeUnit): string {
  const extra = unit.kind === 'formula' ? [unit.expression, ...unit.variables.flatMap(v => [v.symbol, v.meaning])]
    : unit.kind === 'process' ? unit.steps.map(step => step.text)
      : unit.kind === 'definition' ? [unit.term]
        : unit.kind === 'example' ? [unit.illustrates]
          : unit.kind === 'event_or_data' ? [unit.value || '']
            : unit.kind === 'terminology' ? unit.aliases : []
  return [unit.label, unit.statement, ...extra].filter(Boolean).join(' | ')
}

export interface TrueFalseNormalizationResult {
  valid: boolean
  booleanValue?: boolean
  valueClass: TrueFalseValueClass
}

export function normalizeTrueFalseAnswer(raw: unknown): TrueFalseNormalizationResult {
  if (raw === null || raw === undefined) return { valid: false, valueClass: 'nullish' }
  if (typeof raw === 'boolean') {
    if (raw === true) return { valid: true, booleanValue: true, valueClass: 'boolean_true' }
    return { valid: true, booleanValue: false, valueClass: 'boolean_false' }
  }
  if (typeof raw === 'number') {
    if (raw === 0) return { valid: false, valueClass: 'numeric_zero' }
    if (raw === 1) return { valid: false, valueClass: 'numeric_one' }
    return { valid: false, valueClass: 'other' }
  }
  if (typeof raw === 'string') {
    const n = normalizeQuizText(raw)
    if (n === 'true') return { valid: true, booleanValue: true, valueClass: 'string_true' }
    if (n === 'false') return { valid: false, booleanValue: false, valueClass: 'string_false' }
    if (n === 'verdadero') return { valid: true, booleanValue: true, valueClass: 'spanish_true' }
    if (n === 'falso') return { valid: false, booleanValue: false, valueClass: 'spanish_false' }
    return { valid: false, valueClass: 'other' }
  }
  return { valid: false, valueClass: 'other' }
}

interface SchemaDiagnostic {
  field?: string
  rawCorrectAnswerType?: string
  correctAnswerValueClass?: TrueFalseValueClass
}

function sanitizeSchema(raw: any, expectedType: QuizQuestionType, diagnostic?: SchemaDiagnostic): QuizQuestion | null {
  const invalid = (field: string): null => { if (diagnostic) diagnostic.field = field; return null }
  if (!raw || typeof raw !== 'object') return invalid('question')
  if (raw.type !== expectedType) return invalid('type')
  const base = {
    id: String(raw.id || '').trim(), type: expectedType,
    question: String(raw.question || '').trim(), explanation: String(raw.explanation || '').trim(),
    difficulty: ['easy', 'medium', 'hard'].includes(String(raw.difficulty)) ? raw.difficulty : 'medium',
    sourceMaterial: String(raw.sourceMaterial || '').trim(),
    sourcePage: integer(raw.sourcePage) || undefined,
  }
  if (!base.id) return invalid('id')
  if (base.question.length < 8) return invalid('question')
  if (!base.explanation) return invalid('explanation')
  if (expectedType === 'multiple_choice') {
    const options = Array.isArray(raw.options) ? raw.options.map(String).map((v: string) => v.trim()).filter(Boolean) : []
    const correctAnswer = integer(raw.correctAnswer)
    if (options.length !== 4 || new Set(options.map(normalizeQuizText)).size !== 4) return invalid('options')
    if (correctAnswer === null || correctAnswer < 0 || correctAnswer > 3) return invalid('correctAnswer')
    return { ...base, type: expectedType, options, correctAnswer }
  }
  if (expectedType === 'multi_select') {
    const options = Array.isArray(raw.options) ? raw.options.map(String).map((v: string) => v.trim()).filter(Boolean) : []
    const correctAnswers: number[] = Array.isArray(raw.correctAnswers)
      ? [...new Set<number>(raw.correctAnswers.map(integer).filter((v: number | null): v is number => v !== null))]
      : []
    if (options.length < 3 || options.length > 5 || new Set(options.map(normalizeQuizText)).size !== options.length
      ) return invalid('options')
    if (correctAnswers.length < 2 || correctAnswers.some(index => index < 0 || index >= options.length)) return invalid('correctAnswers')
    return { ...base, type: expectedType, options, correctAnswers }
  }
  if (expectedType === 'true_false') {
    if (diagnostic) {
      diagnostic.rawCorrectAnswerType = raw.correctAnswer === null
        ? 'null' : raw.correctAnswer === undefined ? 'undefined' : typeof raw.correctAnswer
    }
    const normalization = normalizeTrueFalseAnswer(raw.correctAnswer)
    if (diagnostic) diagnostic.correctAnswerValueClass = normalization.valueClass
    if (!normalization.valid || normalization.booleanValue === undefined) return invalid('correctAnswer')
    return { ...base, type: expectedType, correctAnswer: normalization.booleanValue }
  }
  if (expectedType === 'fill_blank') {
    const answer = String(raw.answer || '').trim()
    const wordBank = Array.isArray(raw.wordBank) ? raw.wordBank.map(String).map((v: string) => v.trim()).filter(Boolean) : []
    if (!answer) return invalid('answer')
    if (!base.question.includes('___')) return invalid('question')
    if (wordBank.length < 4 || !wordBank.some((item: string) => normalizeQuizText(item) === normalizeQuizText(answer))) return invalid('wordBank')
    return { ...base, type: expectedType, answer, wordBank }
  }
  if (expectedType === 'matching') {
    const pairs = Array.isArray(raw.pairs) ? raw.pairs.map((pair: any) => ({ left: String(pair?.left || '').trim(), right: String(pair?.right || '').trim() })) : []
    if (pairs.length < 2 || pairs.length > 4 || pairs.some((pair: any) => !pair.left || !pair.right)
      || new Set(pairs.map((pair: any) => normalizeQuizText(pair.left))).size !== pairs.length
      || new Set(pairs.map((pair: any) => normalizeQuizText(pair.right))).size !== pairs.length) return invalid('pairs')
    return { ...base, type: expectedType, pairs }
  }
  const acceptedAnswers = Array.isArray(raw.acceptedAnswers) ? raw.acceptedAnswers.map(String).map((v: string) => v.trim()).filter(Boolean).slice(0, 8) : []
  if (!acceptedAnswers.length) return invalid('acceptedAnswers')
  return { ...base, type: 'short_answer', acceptedAnswers, caseInsensitive: true }
}

interface SupportCheckResult {
  supported: boolean
  correctOptionSupported: boolean
  correctAnswerIndexValid: boolean
  optionCount?: number
  mode: SupportCheckMode
}

function contains(canonical: string, value: unknown): boolean {
  const normalized = normalizeQuizText(value)
  return normalized.length >= 2 && canonical.includes(normalized)
}

function targetTextMatches(actual: unknown, canonical: string): boolean {
  const actualText = normalizeQuizText(actual)
  const canonicalText = normalizeQuizText(canonical)
  return actualText.length >= 2 && canonicalText.length >= 2
    && (actualText === canonicalText || actualText.includes(canonicalText) || canonicalText.includes(actualText))
}

function checkTargetAnswerSupport(question: QuizQuestion, answerTarget: AnswerTarget): SupportCheckResult {
  if (question.type === 'multiple_choice') {
    const optionCount = question.options.length
    const indexValid = Number.isInteger(question.correctAnswer) && question.correctAnswer >= 0 && question.correctAnswer < optionCount
    const supported = indexValid && answerTarget.kind === 'single_text' && Boolean(answerTarget.canonicalValue)
      && targetTextMatches(question.options[question.correctAnswer], answerTarget.canonicalValue!)
    return { supported, correctOptionSupported: supported, correctAnswerIndexValid: indexValid, optionCount, mode: 'normalized' }
  }
  if (question.type === 'fill_blank') {
    const supported = answerTarget.kind === 'single_text' && Boolean(answerTarget.canonicalValue)
      && targetTextMatches(question.answer, answerTarget.canonicalValue!)
    return { supported, correctOptionSupported: supported, correctAnswerIndexValid: true, mode: 'normalized' }
  }
  if (question.type === 'short_answer') {
    const supported = answerTarget.kind === 'single_text' && Boolean(answerTarget.canonicalValue)
      && question.acceptedAnswers.some(answer => targetTextMatches(answer, answerTarget.canonicalValue!))
    return { supported, correctOptionSupported: supported, correctAnswerIndexValid: true, mode: 'normalized' }
  }
  if (question.type === 'multi_select') {
    const optionCount = question.options.length
    const indexValid = question.correctAnswers.every(index => Number.isInteger(index) && index >= 0 && index < optionCount)
    const canonicalValues = answerTarget.kind === 'multi_text' ? answerTarget.canonicalValues || [] : []
    const unmatched = new Set(canonicalValues.map((_, index) => index))
    const correctIndexes = new Set(question.correctAnswers)
    let oneToOne = indexValid && canonicalValues.length > 0 && question.correctAnswers.length === canonicalValues.length
    for (const index of question.correctAnswers) {
      const matches = [...unmatched].filter(targetIndex => targetTextMatches(question.options[index], canonicalValues[targetIndex]))
      if (matches.length !== 1) { oneToOne = false; break }
      unmatched.delete(matches[0])
    }
    const conflictingDistractor = question.options.some((option, index) => !correctIndexes.has(index)
      && canonicalValues.some(value => targetTextMatches(option, value)))
    const supported = oneToOne && unmatched.size === 0 && !conflictingDistractor
    return { supported, correctOptionSupported: supported, correctAnswerIndexValid: indexValid, optionCount, mode: 'normalized' }
  }
  if (question.type === 'matching') {
    const pairTargets = answerTarget.kind === 'pairs' ? answerTarget.pairTargets || [] : []
    const unmatched = new Set(pairTargets.map((_, index) => index))
    let supported = question.pairs.length === pairTargets.length && pairTargets.length > 0
    for (const pair of question.pairs) {
      const match = [...unmatched].find(index =>
        normalizeQuizText(pair.left) === normalizeQuizText(pairTargets[index].leftCanonical)
        && normalizeQuizText(pair.right) === normalizeQuizText(pairTargets[index].rightCanonical))
      if (match === undefined) { supported = false; break }
      unmatched.delete(match)
    }
    supported = supported && unmatched.size === 0
    return { supported, correctOptionSupported: supported, correctAnswerIndexValid: true, mode: 'exact' }
  }
  const expected = answerTarget.kind === 'boolean' ? answerTarget.canonicalValue : undefined
  const supported = expected === 'true'
    ? question.correctAnswer === true
    : expected === 'false' && question.correctAnswer === false && Boolean(answerTarget.trueFalseMutation)
      && Boolean(answerTarget.acceptedSurfaceForms?.[0])
      && normalizeQuizText(question.question).includes(normalizeQuizText(answerTarget.acceptedSurfaceForms![0]))
  return { supported, correctOptionSupported: supported, correctAnswerIndexValid: true, mode: 'exact' }
}

export function verifyTrueFalseAnswerTarget(
  brain: MaterialBrain,
  answerTarget: AnswerTarget,
  sourceUnits: KnowledgeUnit[],
): boolean {
  if (answerTarget.kind !== 'boolean' || answerTarget.canonicalValue !== 'false') return true
  const mutation = answerTarget.trueFalseMutation
  const presentedStatement = answerTarget.acceptedSurfaceForms?.[0]
  const unit = sourceUnits[0]
  if (!mutation || mutation.mutationKind !== 'entity_swap' || !unit || !presentedStatement) return false
  if (mutation.originalCanonicalValue !== unit.label || !unit.statement.includes(unit.label)) return false
  const replacement = brain.units.find(candidate => candidate.id !== unit.id
    && candidate.label === mutation.mutatedValue
    && normalizeQuizText(candidate.label) !== normalizeQuizText(unit.label))
  if (!replacement) return false
  const normalizedPresented = normalizeQuizText(presentedStatement)
  if (normalizeQuizText(unit.statement.replace(unit.label, replacement.label)) !== normalizedPresented) return false
  return !brain.units.some(candidate => candidate.id !== unit.id
    && normalizeQuizText(candidate.statement).includes(normalizedPresented))
}

export function persistedTargetQuestionSupported(question: QuizQuestion, answerTarget: AnswerTarget): boolean {
  return checkTargetAnswerSupport(question, answerTarget).supported
}

function checkAnswerSupport(question: QuizQuestion, canonical: string): SupportCheckResult {
  if (question.type === 'multiple_choice') {
    const optionCount = question.options.length
    const indexValid = Number.isInteger(question.correctAnswer) && question.correctAnswer >= 0 && question.correctAnswer < optionCount
    if (!indexValid) return { supported: false, correctOptionSupported: false, correctAnswerIndexValid: false, optionCount, mode: 'normalized' }
    const supported = contains(canonical, question.options[question.correctAnswer])
    return { supported, correctOptionSupported: supported, correctAnswerIndexValid: true, optionCount, mode: 'normalized' }
  }
  if (question.type === 'multi_select') {
    const optionCount = question.options.length
    const indexValid = question.correctAnswers.every(index => Number.isInteger(index) && index >= 0 && index < optionCount)
    if (!indexValid) return { supported: false, correctOptionSupported: false, correctAnswerIndexValid: false, optionCount, mode: 'normalized' }
    const supported = question.correctAnswers.every(index => contains(canonical, question.options[index]))
    return { supported, correctOptionSupported: supported, correctAnswerIndexValid: true, optionCount, mode: 'normalized' }
  }
  if (question.type === 'true_false') {
    const supported = question.correctAnswer === true
    return { supported, correctOptionSupported: supported, correctAnswerIndexValid: true, mode: 'exact' }
  }
  if (question.type === 'fill_blank') {
    const supported = contains(canonical, question.answer)
    return { supported, correctOptionSupported: supported, correctAnswerIndexValid: true, mode: 'normalized' }
  }
  if (question.type === 'short_answer') {
    const supported = question.acceptedAnswers.some(answer => contains(canonical, answer))
    return { supported, correctOptionSupported: supported, correctAnswerIndexValid: true, mode: 'normalized' }
  }
  const supported = question.pairs.every(pair => contains(canonical, pair.left) && contains(canonical, pair.right))
  return { supported, correctOptionSupported: supported, correctAnswerIndexValid: true, mode: 'normalized' }
}

function checkAggregateAnswerSupport(
  question: QuizQuestion,
  sourceUnitIds: string[],
  assertions: Array<{ kind: 'unit' | 'relation'; refId: string; text: string }>,
): SupportCheckResult | null {
  if (sourceUnitIds.length <= 1 || (question.type !== 'multi_select' && question.type !== 'matching')) return null
  const unitTexts = new Map(sourceUnitIds.map(unitId => [
    unitId,
    normalizeQuizText(assertions.filter(item => item.kind === 'unit' && item.refId === unitId).map(item => item.text).join(' | ')),
  ]))
  if (question.type === 'multi_select') {
    const correctIndexes = new Set(question.correctAnswers)
    const matchedCorrectUnits = new Set<string>()
    const correctSupported = question.correctAnswers.every(index => {
      const match = sourceUnitIds.find(unitId => contains(unitTexts.get(unitId) || '', question.options[index]))
      if (match) matchedCorrectUnits.add(match)
      return Boolean(match)
    })
    const conflictingDistractor = question.options.some((option, index) => !correctIndexes.has(index)
      && sourceUnitIds.some(unitId => !matchedCorrectUnits.has(unitId) && contains(unitTexts.get(unitId) || '', option)))
    const supported = correctSupported && !conflictingDistractor
    return {
      supported,
      correctOptionSupported: supported,
      correctAnswerIndexValid: true,
      optionCount: question.options.length,
      mode: 'normalized',
    }
  }
  const supported = question.pairs.length <= sourceUnitIds.length && question.pairs.every((pair, index) => {
    const canonical = unitTexts.get(sourceUnitIds[index]) || ''
    return contains(canonical, pair.left) && contains(canonical, pair.right)
  })
  return { supported, correctOptionSupported: supported, correctAnswerIndexValid: true, mode: 'normalized' }
}

export function persistedQuestionSupported(question: QuizQuestion, assertionTexts: string[], supportingText: unknown): boolean {
  const canonical = normalizeQuizText(assertionTexts.join(' | '))
  const support = String(supportingText || '').trim()
  return Boolean(support) && canonical.includes(normalizeQuizText(support))
    && checkAnswerSupport(question, canonical).supported
}

export interface QuizValidationContext {
  seenIds?: Set<string>
  seenQuestions?: Map<string, string>
  seenIntent?: Map<string, string>
  seenAssessmentIdentity?: Map<string, string>
  eligibleAssessmentIdentities?: Set<string>
}

export interface QuizValidationResult {
  questions: GroundedQuizQuestion[]
  errors: string[]
  diagnostics: QuizRejectionDiagnostic[]
}

export function validateGeneratedQuiz(
  brain: MaterialBrain,
  plan: QuizPlan,
  rawQuestions: unknown[],
  context: QuizValidationContext = {},
): QuizValidationResult {
  const units = new Map(brain.units.map(unit => [unit.id, unit]))
  const relations = new Map(brain.relations.map(relation => [relation.id, relation]))
  const authorized = new Map(brain.scope.materials.map(item => [item.materialId, new Set(item.selectedPages)]))
  const planned = new Map(plan.plannedQuestions.map(item => [item.id, item]))
  const accepted: GroundedQuizQuestion[] = []
  const errors: string[] = []
  const diagnostics: QuizRejectionDiagnostic[] = []
  const seenIds = context.seenIds || new Set<string>()
  const seenQuestions = context.seenQuestions || new Map<string, string>()
  const seenIntent = context.seenIntent || new Map<string, string>()
  const seenAssessmentIdentity = context.seenAssessmentIdentity || new Map<string, string>()

  const push = (diag: QuizRejectionDiagnostic) => { diagnostics.push(diag) }

  for (const raw of rawQuestions) {
    const planId = String((raw as any)?.planId || '')
    const target = planned.get(planId)
    if (!target) {
      errors.push('unknown_plan')
      push({ planId, questionType: 'multiple_choice', unitKind: 'fact', reason: 'unknown_plan' })
      continue
    }
    const meta = { slotId: target.slotId, candidateId: target.candidateId }
    const diagnostic: SchemaDiagnostic = {}
    const question = sanitizeSchema(raw, target.questionType, diagnostic)
    if (!question) {
      errors.push(`invalid_schema:${planId}:${diagnostic.field || 'unknown'}`)
      push({
        planId, ...meta, questionType: target.questionType, unitKind: target.unitKind,
        reason: 'invalid_schema', schemaMismatchField: diagnostic.field,
        ...(diagnostic.rawCorrectAnswerType ? { rawCorrectAnswerType: diagnostic.rawCorrectAnswerType } : {}),
        ...(diagnostic.correctAnswerValueClass ? { correctAnswerValueClass: diagnostic.correctAnswerValueClass } : {}),
      })
      continue
    }
    const sourceUnits = target.sourceUnitIds.map(id => units.get(id)).filter(Boolean) as KnowledgeUnit[]
    if (sourceUnits.length !== target.sourceUnitIds.length) {
      errors.push(`missing_unit:${planId}`)
      push({ planId, ...meta, questionType: target.questionType, unitKind: target.unitKind, reason: 'missing_unit' })
      continue
    }
    if (target.sourceRelationIds.some(id => !relations.has(id))) {
      errors.push(`missing_relation:${planId}`)
      push({ planId, ...meta, questionType: target.questionType, unitKind: target.unitKind, reason: 'missing_relation' })
      continue
    }
    if (!target.evidence.length || !target.evidence.every(validateSourceEvidence)) {
      errors.push(`invalid_evidence:${planId}`)
      push({ planId, ...meta, questionType: target.questionType, unitKind: target.unitKind, reason: 'invalid_evidence' })
      continue
    }
    const leakage = target.evidence.some(evidence => {
      const pages = authorized.get(evidence.materialId)
      return !pages || (pages.size > 0 && !pages.has(evidence.page))
    })
    if (leakage) {
      errors.push(`source_leakage:${planId}`)
      push({ planId, ...meta, questionType: target.questionType, unitKind: target.unitKind, reason: 'source_leakage' })
      continue
    }
    // Evidence-linked grounding (Blocker 4):
    // Only include relation statements when the plan carried an EvidenceLink
    // that authoritatively backs that relation. Relations without valid
    // authorized evidence NEVER contribute to canonical answer authority.
    const provenAssertions = (target.evidenceLinks || []).flatMap(link =>
      verifyEvidenceLink(link, units, relations) || [])
    const backedUnitIds = new Set(provenAssertions.filter(a => a.kind === 'unit').map(a => a.refId))
    const backedRelationIds = new Set(provenAssertions.filter(a => a.kind === 'relation').map(a => a.refId))
    if (target.sourceUnitIds.some(id => !backedUnitIds.has(id))) {
      errors.push(`invalid_evidence:${planId}`)
      push({ planId, ...meta, questionType: target.questionType, unitKind: target.unitKind, reason: 'invalid_evidence' })
      continue
    }
    const provenAssertionIds = new Set(provenAssertions.map(assertion => assertion.assertionId))
    const targetAssertionIds = [...new Set([
      ...target.answerTarget.assertionIds,
      ...target.groundingTarget.evidenceBackedAssertionIds,
    ])]
    const groundingTargetValid = targetAssertionIds.length > 0
      && targetAssertionIds.every(id => provenAssertionIds.has(id))
      && target.groundingTarget.sourceUnitIds.length === target.sourceUnitIds.length
      && target.groundingTarget.sourceUnitIds.every(id => target.sourceUnitIds.includes(id))
      && target.groundingTarget.sourceRelationIds.length === target.sourceRelationIds.length
      && target.groundingTarget.sourceRelationIds.every(id => target.sourceRelationIds.includes(id))
    if (!groundingTargetValid) {
      errors.push(`invalid_evidence:${planId}`)
      push({ planId, ...meta, questionType: target.questionType, unitKind: target.unitKind, reason: 'invalid_evidence' })
      continue
    }
    if (!verifyTrueFalseAnswerTarget(brain, target.answerTarget, sourceUnits)) {
      errors.push(`unsupported_answer:${planId}`)
      push({
        planId, ...meta, questionType: target.questionType, unitKind: target.unitKind,
        reason: 'unsupported_answer', subReason: 'correct_option_not_supported',
      })
      continue
    }
    const canonicalText = normalizeQuizText(provenAssertions.map(assertion => assertion.text).join(' | '))
    const supportingText = String((raw as any)?.supportingText || '').trim()
    const supportingTextPresent = supportingText.length > 0
    const supportingTextMatched = supportingTextPresent && canonicalText.includes(normalizeQuizText(supportingText))
    const hasTargetPath = Boolean(target.answerTarget?.kind && target.groundingTarget?.evidenceBackedAssertionIds?.length)
    const answerSupport = hasTargetPath
      ? checkTargetAnswerSupport(question, target.answerTarget)
      : checkAggregateAnswerSupport(question, target.sourceUnitIds, provenAssertions) || checkAnswerSupport(question, canonicalText)

    if ((!hasTargetPath && (!supportingTextPresent || !supportingTextMatched)) || !answerSupport.supported) {
      let subReason: QuizRejectionDiagnostic['subReason']
      if (!hasTargetPath && !supportingTextPresent) subReason = 'supporting_text_missing'
      else if (!hasTargetPath && !supportingTextMatched) subReason = 'supporting_text_not_found'
      else if (!answerSupport.correctAnswerIndexValid) subReason = 'correct_answer_index_invalid'
      else subReason = 'correct_option_not_supported'
      errors.push(`unsupported_answer:${planId}`)
      push({
        planId, ...meta, questionType: target.questionType, unitKind: target.unitKind,
        reason: 'unsupported_answer', subReason,
        supportingTextPresent, supportingTextMatched,
        correctOptionSupported: answerSupport.correctOptionSupported,
        correctAnswerIndexValid: answerSupport.correctAnswerIndexValid,
        supportCheckMode: answerSupport.mode,
        ...(answerSupport.optionCount !== undefined ? { optionCount: answerSupport.optionCount } : {}),
      })
      continue
    }

    const normalizedQuestion = normalizeQuizText(question.question)
    if (seenIds.has(question.id)) {
      errors.push(`duplicate:${planId}`)
      push({ planId, ...meta, questionType: target.questionType, unitKind: target.unitKind, reason: 'duplicate', subReason: 'duplicate_id' })
      continue
    }
    if (seenQuestions.has(normalizedQuestion)) {
      errors.push(`duplicate:${planId}`)
      push({
        planId, ...meta, questionType: target.questionType, unitKind: target.unitKind,
        reason: 'duplicate', subReason: 'duplicate_question',
        duplicateAgainstPlanId: seenQuestions.get(normalizedQuestion),
      })
      continue
    }
    if (seenIntent.has(target.intent)) {
      errors.push(`duplicate:${planId}`)
      push({
        planId, ...meta, questionType: target.questionType, unitKind: target.unitKind,
        reason: 'duplicate', subReason: 'duplicate_intent',
        duplicateAgainstPlanId: seenIntent.get(target.intent),
      })
      continue
    }
    const eligibleAssessmentIdentities = context.eligibleAssessmentIdentities
    const plannedTypeCount = plan.plannedQuestions.filter(item => item.questionType === target.questionType).length
    const availableAssessmentIdentities = new Set(plan.globalCandidatePool
      .filter(item => item.questionType === target.questionType).map(item => item.assessmentSemanticIdentity))
    const hasEnoughSemanticCapacity = eligibleAssessmentIdentities
      ? eligibleAssessmentIdentities.size > 1
      : availableAssessmentIdentities.size >= plannedTypeCount
    const hasUnusedAssessmentAlternative = [...(eligibleAssessmentIdentities || availableAssessmentIdentities)]
      .some(identity => identity !== target.assessmentSemanticIdentity && !seenAssessmentIdentity.has(identity))
    if (seenAssessmentIdentity.has(target.assessmentSemanticIdentity)
      && hasEnoughSemanticCapacity && hasUnusedAssessmentAlternative) {
      errors.push(`duplicate:${planId}`)
      push({
        planId, ...meta, questionType: target.questionType, unitKind: target.unitKind,
        reason: 'duplicate', subReason: 'duplicate_assessment_identity',
        duplicateAgainstPlanId: seenAssessmentIdentity.get(target.assessmentSemanticIdentity),
      })
      continue
    }
    seenIds.add(question.id)
    seenQuestions.set(normalizedQuestion, planId)
    seenIntent.set(target.intent, planId)
    seenAssessmentIdentity.set(target.assessmentSemanticIdentity, planId)
    accepted.push({
      ...question,
      type: target.questionType,
      difficulty: target.difficulty,
      sourceMaterial: target.sourceMaterialId,
      sourcePage: target.sourcePage,
      grounding: {
        planId,
        slotId: target.slotId,
        candidateId: target.candidateId,
        assessmentIntent: target.assessmentIntent,
        assessmentSemanticIdentity: target.assessmentSemanticIdentity,
        sourceUnitIds: [...target.sourceUnitIds],
        sourceRelationIds: [...target.sourceRelationIds].filter(id => backedRelationIds.has(id)),
        evidence: target.evidence,
        evidenceLinks: target.evidenceLinks ? JSON.parse(JSON.stringify(target.evidenceLinks)) : undefined,
        answerTarget: JSON.parse(JSON.stringify(target.answerTarget)),
        groundingTarget: JSON.parse(JSON.stringify(target.groundingTarget)),
        supportingText,
      },
    } as GroundedQuizQuestion)
  }
  return { questions: accepted, errors, diagnostics }
}

export function plannedContext(brain: MaterialBrain, planned: PlannedQuizQuestion) {
  const units = new Map(brain.units.map(unit => [unit.id, unit]))
  const relations = new Map(brain.relations.map(relation => [relation.id, relation]))
  const selectedAssertionIds = new Set(planned.groundingTarget.evidenceBackedAssertionIds)
  const assertionsByUnit = new Map<string, EvidenceBackedAssertion[]>()
  const authorizedAssertionsByUnit = new Map<string, EvidenceBackedAssertion[]>()
  for (const link of planned.evidenceLinks || []) {
    if (link.kind !== 'unit') continue
    authorizedAssertionsByUnit.set(link.refId, link.assertions)
    assertionsByUnit.set(link.refId, link.assertions.filter(assertion => selectedAssertionIds.has(assertion.assertionId)))
  }
  return {
    planId: planned.id,
    requiredType: planned.questionType,
    difficulty: planned.difficulty,
    cognitiveIntent: planned.cognitiveIntent,
    ...(planned.recentKnowledgeTargetsToAvoid?.length ? {
      recentKnowledgeTargetsToAvoid: [...planned.recentKnowledgeTargetsToAvoid],
    } : {}),
    assessmentIntent: planned.assessmentIntent,
    transformationVariant: planned.transformationVariant,
    answerTarget: {
      ...planned.answerTarget,
      assertionIds: undefined,
      pairTargets: planned.answerTarget.pairTargets?.map(pair => ({
        leftCanonical: pair.leftCanonical,
        rightCanonical: pair.rightCanonical,
      })),
    },
    units: planned.sourceUnitIds.map(id => units.get(id)).filter(Boolean).map(unit => {
      const groundedAssertions = assertionsByUnit.get(unit!.id) || []
      const authorityText = groundedAssertions[0]?.text || ''
      const groundedTexts = new Set((authorizedAssertionsByUnit.get(unit!.id) || [])
        .map(assertion => normalizeQuizText(assertion.text)))
      const isGrounded = (value: string) => groundedTexts.has(normalizeQuizText(value))
      const label = groundedTexts.has(normalizeQuizText(unit!.label)) ? unit!.label : authorityText
      const statement = groundedTexts.has(normalizeQuizText(unit!.statement)) ? unit!.statement : authorityText
      return {
        id: unit!.id, kind: unit!.kind, label, statement,
        ...(unit!.kind === 'formula' ? {
          ...(isGrounded(unit!.expression) ? { expression: unit!.expression } : {}),
          variables: unit!.variables.filter(variable => isGrounded(variable.symbol) && isGrounded(variable.meaning)),
        } : {}),
        ...(unit!.kind === 'process' ? { steps: unit!.steps.filter(step => isGrounded(step.text)) } : {}),
        ...(unit!.kind === 'definition' && isGrounded(unit!.term) ? { term: unit!.term } : {}),
        ...(unit!.kind === 'terminology' ? { aliases: unit!.aliases.filter(isGrounded) } : {}),
        ...(unit!.kind === 'event_or_data' && unit!.value && isGrounded(unit!.value) ? { value: unit!.value } : {}),
        ...(unit!.kind === 'example' && isGrounded(unit!.illustrates) ? { illustrates: unit!.illustrates } : {}),
        groundedAssertions: groundedAssertions.map(assertion => assertion.text),
      }
    }),
    relations: planned.sourceRelationIds.map(id => relations.get(id)).filter(Boolean).map(relation => ({
      id: relation!.id, type: relation!.type, statement: relation!.statement,
    })),
  }
}
