import { createHash } from 'node:crypto'
import { dedupeSourceEvidence, type SourceEvidence } from '../../materials/sourceEvidence'
import type { QuizQuestionType } from '../../types/quiz'
import { normalizeSemanticText } from '../identity'
import type { KnowledgeUnit, MaterialBrain } from '../types'
import {
  authoritativeEvidenceForRelation, authoritativeEvidenceForUnit,
  evidenceAuthorityText, evidenceLinkForRelation, evidenceLinkForUnit,
} from './grounding'
import { normalizeQuizText } from './validate'
import type {
    AnswerTarget, EvidenceBackedAssertion, EvidenceLink, PlannedQuizQuestion, QuizCandidatePlan, QuizConfig, QuizDifficulty,
  QuizCoverageAnalysis, QuizGenerationHistoryRecord, QuizPlan, QuizPlanSlot,
} from './types'
import { hashToSeed } from './random'
import { allocateQuizTypeCounts, quizAllocationSeed, seededQuizTypeOrder } from './allocation'

export interface PlanQuizOptions {
  generationId?: string
  history?: QuizGenerationHistoryRecord
  allocationSeed?: string
  /** Internal analysis fast path: build the exact candidate universe, not N slots. */
  coverageOnly?: boolean
}

export function quizKnowledgeTargetId(sourceUnitIds: readonly string[], sourceRelationIds: readonly string[]): string {
  return [...sourceUnitIds, ...sourceRelationIds].sort().join('|')
}

function assessmentSemanticIdentityFor(
  questionType: QuizQuestionType,
  answerTarget: AnswerTarget,
  cognitiveIntent: QuizCandidatePlan['cognitiveIntent'],
): string {
  let canonical: string[]
  if (answerTarget.kind === 'multi_text') {
    canonical = (answerTarget.canonicalValues || []).map(normalizeQuizText).sort()
  } else if (answerTarget.kind === 'pairs') {
    canonical = (answerTarget.pairTargets || []).map(pair =>
      `${normalizeQuizText(pair.leftCanonical)}=>${normalizeQuizText(pair.rightCanonical)}`).sort()
  } else {
    canonical = [normalizeQuizText(String(answerTarget.canonicalValue ?? ''))]
  }
  const assertions = [...answerTarget.assertionIds].sort().join('|')
  return `${questionType}:${cognitiveIntent}:${canonical.join('|')}:assertions=${assertions}`
}

export function quizAssessmentSemanticIdentity(
  candidate: QuizCandidatePlan | PlannedQuizQuestion,
): string {
  return assessmentSemanticIdentityFor(candidate.questionType, candidate.answerTarget, candidate.cognitiveIntent)
}

function cognitiveIntentForDifficulty(difficulty: QuizDifficulty): QuizCandidatePlan['cognitiveIntent'] {
  return difficulty === 'easy' ? 'recall' : difficulty === 'hard' ? 'integrate' : 'discriminate'
}

const ALL_TYPES: QuizQuestionType[] = [
  'multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer',
]

export function normalizeQuizConfig(value: unknown): QuizConfig {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const questionCount = Number(input.questionCount)
  const difficulty = String(input.difficulty || '') as QuizDifficulty
  const requested = Array.isArray(input.questionTypes) ? input.questionTypes.map(String) : []
  const questionTypes = ALL_TYPES.filter(type => requested.includes(type))
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 100) throw new Error('INVALID_CONFIG')
  if (!['easy', 'medium', 'hard'].includes(difficulty) || questionTypes.length === 0) throw new Error('INVALID_CONFIG')
  return {
    questionCount, difficulty, questionTypes,
    ...(typeof input.language === 'string' && input.language.trim() ? { language: input.language.trim().slice(0, 20) } : {}),
  }
}

export function quizConfigFingerprint(config: QuizConfig): string {
  const canonical = {
    questionCount: config.questionCount,
    difficulty: config.difficulty,
    questionTypes: [...config.questionTypes].sort(),
    language: config.language || '',
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function unitEvidence(unit: KnowledgeUnit): SourceEvidence[] {
  return authoritativeEvidenceForUnit(unit)
}

function relationEvidence(relation: MaterialBrain['relations'][number]): SourceEvidence[] {
  return authoritativeEvidenceForRelation(relation)
}

function typeFitness(kind: KnowledgeUnit['kind'], allowed: QuizQuestionType[]): QuizQuestionType[] {
  const preferred: Record<KnowledgeUnit['kind'], QuizQuestionType[]> = {
    formula: ['fill_blank', 'matching', 'multi_select', 'short_answer', 'multiple_choice', 'true_false'],
    process: ['matching', 'multi_select', 'short_answer', 'multiple_choice', 'fill_blank', 'true_false'],
    definition: ['fill_blank', 'multiple_choice', 'matching', 'short_answer', 'true_false'],
    terminology: ['matching', 'multi_select', 'fill_blank', 'multiple_choice', 'short_answer', 'true_false'],
    event_or_data: ['multiple_choice', 'fill_blank', 'short_answer', 'true_false'],
    example: ['multiple_choice', 'short_answer', 'fill_blank', 'true_false'],
    concept: ['multiple_choice', 'short_answer', 'fill_blank', 'true_false', 'multi_select'],
    fact: ['multiple_choice', 'fill_blank', 'short_answer', 'true_false', 'multi_select', 'matching'],
  }
  return preferred[kind].filter(type => allowed.includes(type))
}

function unitSupportsType(unit: KnowledgeUnit, type: QuizQuestionType, hasGroundedRelation: boolean): boolean {
  if (type === 'matching') return unit.kind === 'formula' && unit.variables.length >= 2
  if (type === 'multi_select') {
    if (unit.kind === 'process') return unit.steps.length >= 2
    if (unit.kind === 'formula') return unit.variables.length >= 2
    if (unit.kind === 'terminology') return unit.aliases.length >= 2
    return false
  }
  if (type === 'true_false') {
    return Boolean(unit.statement && unit.statement.trim().length >= 8)
  }
  return true
}

const TRANSFORMATION_VARIANTS: Record<QuizQuestionType, string[]> = {
  multiple_choice: [
    'direct_recall', 'reverse_recall', 'attribute_identification', 'statement_selection',
    'subject_from_assertion', 'assertion_from_subject', 'context_recall', 'evidence_recall',
    'completion_choice', 'truth_discrimination',
  ],
  short_answer: [
    'direct_recall', 'reverse_recall', 'attribute_recall',
    'subject_identification', 'statement_completion', 'assertion_explanation',
  ],
  fill_blank: ['completion_subject', 'completion_attribute', 'completion_statement', 'completion_reverse', 'completion_context'],
  true_false: ['grounded_statement', 'grounded_attribute', 'grounded_context'],
  multi_select: ['structured_attributes', 'structured_components', 'structured_relationships', 'structured_classification'],
  matching: ['match_pairs_direct', 'match_pairs_reverse', 'match_attributes', 'match_relationships'],
}

export function quizUnitRank(unit: KnowledgeUnit): number {
  const tier = unit.importance.tier === 'critical' ? 30 : unit.importance.tier === 'supporting' ? 20 : 10
  const kind = ['formula', 'process', 'definition'].includes(unit.kind) ? 4 : 0
  return tier + kind + Math.round(unit.importance.confidence * 3)
}

export function allocateQuizTypeTargets(
  questionCount: number,
  selectedTypes: QuizQuestionType[],
  capacity: ReadonlyMap<QuizQuestionType, number>,
  seed = quizAllocationSeed(questionCount, selectedTypes, 'medium'),
): Map<QuizQuestionType, number> {
  // Diagnostic/internal plans may inspect capability with N<K. Product entry
  // points reject that setup; keep these inspections deterministic and finite.
  const ideal = questionCount < selectedTypes.length
    ? new Map<QuizQuestionType, number>(selectedTypes.map(type => [type, 0]))
    : allocateQuizTypeCounts(questionCount, selectedTypes, seed)
  if (questionCount < selectedTypes.length) {
    for (const type of seededQuizTypeOrder(selectedTypes, seed).slice(0, questionCount)) ideal.set(type, 1)
  }
  const targets = new Map<QuizQuestionType, number>(selectedTypes.map(type => [
    type, Math.min(ideal.get(type) || 0, capacity.get(type) || 0),
  ]))
  let left = questionCount - [...targets.values()].reduce((sum, count) => sum + count, 0)
  const eligible = selectedTypes.filter(type => (capacity.get(type) || 0) > 0)
  const ring = seededQuizTypeOrder(eligible, seed)
  let cursor = 0
  while (left > 0 && eligible.length > 0) {
    const type = ring[cursor % ring.length]
    if ((targets.get(type) || 0) < (capacity.get(type) || 0)) {
      targets.set(type, (targets.get(type) || 0) + 1)
      left -= 1
    }
    cursor += 1
    if (cursor > eligible.length * (questionCount + 4)) break
  }
  return targets
}

export function compareQuizCandidatePlans(
  a: QuizCandidatePlan,
  b: QuizCandidatePlan,
  bucketUsage: ReadonlyMap<string, number> = new Map(),
  ranks: ReadonlyMap<string, number> = new Map(),
): number {
  const bucketA = `${a.sourceMaterialId}:${a.sourcePage}`
  const bucketB = `${b.sourceMaterialId}:${b.sourcePage}`
  const usageDifference = (bucketUsage.get(bucketA) || 0) - (bucketUsage.get(bucketB) || 0)
  if (usageDifference) return usageDifference
  const variantA = TRANSFORMATION_VARIANTS[a.questionType].indexOf(a.transformationVariant)
  const variantB = TRANSFORMATION_VARIANTS[b.questionType].indexOf(b.transformationVariant)
  if (variantA !== variantB) return variantA - variantB
  const rankA = Math.max(0, ...a.sourceUnitIds.map(id => ranks.get(id) || 0))
  const rankB = Math.max(0, ...b.sourceUnitIds.map(id => ranks.get(id) || 0))
  if (rankA !== rankB) return rankB - rankA
  if (bucketA !== bucketB) return bucketA.localeCompare(bucketB)
  return a.candidateId.localeCompare(b.candidateId)
}

export interface QuizCandidateNoveltyRankingContext {
  historyCounts: ReadonlyMap<string, number>
  assessmentHistoryCounts: ReadonlyMap<string, number>
  generationId?: string
  repeatDepthByKnowledgeTarget: ReadonlyMap<string, number>
  repeatDepthByAssessmentIdentity: ReadonlyMap<string, number>
  repeatDepthByUnit: ReadonlyMap<string, number>
  repeatDepthByCanonicalSubject: ReadonlyMap<string, number>
  bucketUsage: ReadonlyMap<string, number>
  ranks: ReadonlyMap<string, number>
  canonicalSubjectByUnit: ReadonlyMap<string, string>
  selectedTypes: readonly QuizQuestionType[]
}

/**
 * Shared ranking from cross-generation novelty downward. Type scarcity remains
 * caller-specific: allocatePlan compares compatible.length first, while
 * recovery compares the current type deficit first.
 */
export function compareQuizCandidateNovelty(
  a: QuizCandidatePlan,
  b: QuizCandidatePlan,
  context: QuizCandidateNoveltyRankingContext,
): number {
  const targetA = quizKnowledgeTargetId(a.sourceUnitIds, a.sourceRelationIds)
  const targetB = quizKnowledgeTargetId(b.sourceUnitIds, b.sourceRelationIds)
  const knowledgeRepeatA = context.repeatDepthByKnowledgeTarget.get(targetA) || 0
  const knowledgeRepeatB = context.repeatDepthByKnowledgeTarget.get(targetB) || 0
  if (knowledgeRepeatA !== knowledgeRepeatB) return knowledgeRepeatA - knowledgeRepeatB
  const assessmentA = quizAssessmentSemanticIdentity(a)
  const assessmentB = quizAssessmentSemanticIdentity(b)
  const assessmentRepeatA = context.repeatDepthByAssessmentIdentity.get(assessmentA) || 0
  const assessmentRepeatB = context.repeatDepthByAssessmentIdentity.get(assessmentB) || 0
  if (assessmentRepeatA !== assessmentRepeatB) return assessmentRepeatA - assessmentRepeatB
  const historyA = context.historyCounts.get(targetA) || 0
  const historyB = context.historyCounts.get(targetB) || 0
  const everA = historyA > 0
  const everB = historyB > 0
  if (everA !== everB) return everA ? 1 : -1
  if (historyA !== historyB) return historyA - historyB
  const assessmentHistoryA = context.assessmentHistoryCounts.get(assessmentA) || 0
  const assessmentHistoryB = context.assessmentHistoryCounts.get(assessmentB) || 0
  if (assessmentHistoryA !== assessmentHistoryB) return assessmentHistoryA - assessmentHistoryB
  const complexityA = a.sourceUnitIds.length + a.sourceRelationIds.length
  const complexityB = b.sourceUnitIds.length + b.sourceRelationIds.length
  if (a.difficulty === 'hard' && complexityA !== complexityB) return complexityB - complexityA
  if (a.difficulty === 'easy' && complexityA !== complexityB) return complexityA - complexityB
  const primaryUnitA = a.sourceUnitIds[0] || ''
  const primaryUnitB = b.sourceUnitIds[0] || ''
  const unitDepthA = context.repeatDepthByUnit.get(primaryUnitA) || 0
  const unitDepthB = context.repeatDepthByUnit.get(primaryUnitB) || 0
  if (unitDepthA !== unitDepthB) return unitDepthA - unitDepthB
  const subjectA = context.canonicalSubjectByUnit.get(primaryUnitA) || ''
  const subjectB = context.canonicalSubjectByUnit.get(primaryUnitB) || ''
  const subjectDepthA = context.repeatDepthByCanonicalSubject.get(subjectA) || 0
  const subjectDepthB = context.repeatDepthByCanonicalSubject.get(subjectB) || 0
  if (subjectDepthA !== subjectDepthB) return subjectDepthA - subjectDepthB
  const bucketA = `${a.sourceMaterialId}:${a.sourcePage}`
  const bucketB = `${b.sourceMaterialId}:${b.sourcePage}`
  const usageDifference = (context.bucketUsage.get(bucketA) || 0) - (context.bucketUsage.get(bucketB) || 0)
  if (usageDifference) return usageDifference
  const fitAIndex = typeFitness(a.unitKind, [...context.selectedTypes]).indexOf(a.questionType)
  const fitBIndex = typeFitness(b.unitKind, [...context.selectedTypes]).indexOf(b.questionType)
  const fitA = fitAIndex < 0 ? 99 : fitAIndex
  const fitB = fitBIndex < 0 ? 99 : fitBIndex
  if (fitA !== fitB) return fitA - fitB
  const variantA = TRANSFORMATION_VARIANTS[a.questionType].indexOf(a.transformationVariant)
  const variantB = TRANSFORMATION_VARIANTS[b.questionType].indexOf(b.transformationVariant)
  if (variantA !== variantB) return variantA - variantB
  const rankA = Math.max(0, ...a.sourceUnitIds.map(id => context.ranks.get(id) || 0))
  const rankB = Math.max(0, ...b.sourceUnitIds.map(id => context.ranks.get(id) || 0))
  if (rankA !== rankB) return rankB - rankA
  if (context.generationId) {
    const seeded = hashToSeed(context.generationId, a.candidateId) - hashToSeed(context.generationId, b.candidateId)
    if (seeded) return seeded
  }
  return a.candidateId.localeCompare(b.candidateId)
}

function semanticDedupeCandidates<T extends { unit: KnowledgeUnit; evidence: SourceEvidence[] }>(items: T[]): T[] {
  const survivors = new Map<string, T>()
  const order: string[] = []
  for (const item of items) {
    const identity = item.unit.identity || ({} as KnowledgeUnit['identity'])
    const semanticKey = String(identity.semanticKey || '').trim().toLowerCase()
    const canonicalSubject = String(identity.canonicalSubject || '').trim().toLowerCase()
    const qualifiers = Array.isArray(identity.qualifiers)
      ? [...identity.qualifiers].map(q => String(q || '').trim().toLowerCase()).filter(Boolean).sort().join('|')
      : ''
    if (!semanticKey || !canonicalSubject) {
      const key = `__unique__:${item.unit.id}`
      survivors.set(key, item); order.push(key); continue
    }
    // Preserve distinct grounded assertions under the same entity/semantic key;
    // only collapse candidates whose actual knowledge statement is also equal.
    const statement = normalizeSemanticText(item.unit.statement)
    const key = `${semanticKey}::${canonicalSubject}::${qualifiers}::${statement}`
    const existing = survivors.get(key)
    if (!existing) { survivors.set(key, item); order.push(key); continue }
    const winner = quizUnitRank(item.unit) > quizUnitRank(existing.unit) ? item : existing
    survivors.set(key, winner)
  }
  return order.map(key => survivors.get(key)!).filter(Boolean)
}

interface AllocCandidate {
  unit: KnowledgeUnit
  evidence: SourceEvidence[]
  compatible: QuizQuestionType[]
  rank: number
  materialPageKey: string
}

function normalizedPlannerText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

function assertionForCanonical(assertions: EvidenceBackedAssertion[], canonical: string): EvidenceBackedAssertion | null {
  const target = normalizedPlannerText(canonical)
  const targetTokens = new Set(normalizeSemanticText(canonical).split(' ').filter(Boolean))
  const exact = assertions.find(assertion => normalizedPlannerText(assertion.text) === target)
  if (exact) return exact
  return assertions.find(assertion => {
    const text = normalizedPlannerText(assertion.text)
    if (text.includes(target) || target.includes(text)) return true
    if (targetTokens.size === 0) return false
    const assertionTokens = new Set(normalizeSemanticText(assertion.text).split(' ').filter(Boolean))
    return [...targetTokens].every(token => assertionTokens.has(token))
  }) || null
}

function exactAssertionForCanonical(
  assertions: EvidenceBackedAssertion[],
  canonical: string,
): EvidenceBackedAssertion | null {
  const target = normalizedPlannerText(canonical)
  return assertions.find(assertion => normalizedPlannerText(assertion.text) === target) || null
}

interface GroundedUnitAnswerAuthority {
  link: EvidenceLink
  assertion: EvidenceBackedAssertion
  canonicalValue: string
  source: 'label' | 'structured' | 'statement' | 'verbatim_evidence'
}

function groundedUnitAnswerAuthority(
  unit: KnowledgeUnit,
  evidence: SourceEvidence[],
): GroundedUnitAnswerAuthority | null {
  const link = evidenceLinkForUnit(unit, evidence, { includeVerbatimEvidence: true })
  if (!link) return null
  const labelAssertion = exactAssertionForCanonical(link.assertions, unit.label)
  if (labelAssertion) return { link, assertion: labelAssertion, canonicalValue: labelAssertion.text, source: 'label' }
  const structuredValues = unit.kind === 'definition' ? [unit.term]
    : unit.kind === 'event_or_data' ? [unit.value || '']
      : unit.kind === 'formula' ? [unit.expression]
        : unit.kind === 'terminology' ? unit.aliases
          : []
  for (const value of structuredValues) {
    const assertion = exactAssertionForCanonical(link.assertions, value)
    if (assertion) return { link, assertion, canonicalValue: assertion.text, source: 'structured' }
  }
  const statementAssertion = exactAssertionForCanonical(link.assertions, unit.statement)
  if (statementAssertion) return { link, assertion: statementAssertion, canonicalValue: statementAssertion.text, source: 'statement' }
  const evidenceTexts = new Set(evidence.map(evidenceAuthorityText).map(normalizedPlannerText))
  const verbatim = link.assertions.find(assertion => evidenceTexts.has(normalizedPlannerText(assertion.text)))
  return verbatim
    ? { link, assertion: verbatim, canonicalValue: verbatim.text, source: 'verbatim_evidence' }
    : null
}

function groundedMatchingMember(item: { unit: KnowledgeUnit; evidence: SourceEvidence[] }): {
  link: EvidenceLink
  leftCanonical: string
  rightCanonical: string
  leftAssertion: EvidenceBackedAssertion
  rightAssertion: EvidenceBackedAssertion
} | null {
  const link = evidenceLinkForUnit(item.unit, item.evidence, { includeVerbatimEvidence: true })
  if (!link) return null
  const leftCanonical = item.unit.kind === 'definition' ? item.unit.term : item.unit.label
  const leftAssertion = assertionForCanonical(link.assertions, leftCanonical)
  if (!leftAssertion) return null
  const exactStatement = exactAssertionForCanonical(link.assertions, item.unit.statement)
  const evidenceTexts = new Set(item.evidence.map(evidenceAuthorityText).map(normalizedPlannerText))
  const verbatimEvidenceAssertion = link.assertions.find(assertion =>
    evidenceTexts.has(normalizedPlannerText(assertion.text))) || null
  const rightAssertion = exactStatement || verbatimEvidenceAssertion
  if (!rightAssertion) return null
  const rightCanonical = rightAssertion.text
  if (!normalizeQuizText(leftCanonical)
    || normalizeQuizText(leftCanonical) === normalizeQuizText(rightCanonical)) return null
  return { link, leftCanonical, rightCanonical, leftAssertion, rightAssertion }
}

function buildCandidatePlan(
  brain: MaterialBrain,
  authorized: Map<string, Set<number>>,
  unit: KnowledgeUnit,
  evidence: SourceEvidence[],
  questionType: QuizQuestionType,
  transformationVariant: string,
  difficulty: QuizDifficulty,
): QuizCandidatePlan | null {
  const authority = groundedUnitAnswerAuthority(unit, evidence)
  if (!authority) return null
  const unitLink = authority.link
  // Only include relations whose evidence exists AND is entirely authorized.
  // A relation without valid authorized evidence must NOT contribute
  // grounded answer authority (Blocker 4).
  const authorizedRelations = brain.relations
    .filter(relation => relation.fromUnitId === unit.id || relation.toUnitId === unit.id)
    .map(relation => ({ relation, evidence: relationEvidence(relation) }))
    .filter(({ evidence: relEv }) => relEv.length > 0 && relEv.every(item => {
      const pages = authorized.get(item.materialId)
      return Boolean(pages && (pages.size === 0 || pages.has(item.page)))
    }))
    .map(item => ({ ...item, link: evidenceLinkForRelation(item.relation, item.evidence) }))
    .filter((item): item is typeof item & { link: NonNullable<typeof item.link> } => Boolean(item.link))
    .slice(0, 2)
  const combinedEvidence = dedupeSourceEvidence([
    ...evidence,
    ...authorizedRelations.flatMap(r => r.evidence),
  ])
  const evidenceLinks = [unitLink, ...authorizedRelations.map(r => r.link)]
  const labelAssertion = exactAssertionForCanonical(unitLink.assertions, unit.label)
  const exactStatementAssertion = exactAssertionForCanonical(unitLink.assertions, unit.statement)
  const statementAssertion = exactStatementAssertion || authority.assertion
  const structuredValues = unit.kind === 'process' ? unit.steps.map(step => step.text)
    : unit.kind === 'formula' ? unit.variables.map(variable => variable.meaning)
      : unit.kind === 'terminology' ? unit.aliases : []
  const structuredMembers = structuredValues.slice(0, 4).map(value => ({
    value,
    assertion: assertionForCanonical(unitLink.assertions, value),
  })).filter((member): member is { value: string; assertion: EvidenceBackedAssertion } => Boolean(member.assertion))
  let answerTarget: AnswerTarget
  if (questionType === 'true_false') {
    answerTarget = { kind: 'boolean', canonicalValue: 'true', assertionIds: [statementAssertion.assertionId] }
    if (exactStatementAssertion && transformationVariant !== 'grounded_statement' && unit.statement.includes(unit.label)) {
      const replacements = brain.units
        .filter(candidate => candidate.id !== unit.id && normalizedPlannerText(candidate.label) !== normalizedPlannerText(unit.label))
        .filter(candidate => authoritativeEvidenceForUnit(candidate).some(item => {
          const pages = authorized.get(item.materialId)
          return Boolean(pages && (pages.size === 0 || pages.has(item.page)))
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
      const orderedReplacements = [
        ...replacements.filter(candidate => candidate.id.localeCompare(unit.id) > 0),
        ...replacements.filter(candidate => candidate.id.localeCompare(unit.id) <= 0),
      ]
      const replacement = orderedReplacements.find(candidate => {
        const mutated = normalizedPlannerText(unit.statement.replace(unit.label, candidate.label))
        return !brain.units.some(other => other.id !== unit.id
          && normalizedPlannerText(other.statement).includes(mutated))
      })
      if (replacement) {
        const mutatedStatement = unit.statement.replace(unit.label, replacement.label)
        answerTarget = {
          kind: 'boolean',
          canonicalValue: 'false',
          assertionIds: [statementAssertion.assertionId],
          acceptedSurfaceForms: [mutatedStatement],
          trueFalseMutation: {
            mutationKind: 'entity_swap',
            originalCanonicalValue: unit.label,
            mutatedValue: replacement.label,
          },
        }
      }
    }
  } else if (questionType === 'multi_select') {
    if (structuredMembers.length < 2) return null
    answerTarget = {
      kind: 'multi_text',
      canonicalValues: structuredMembers.map(member => member.value),
      assertionIds: structuredMembers.map(member => member.assertion.assertionId),
    }
  } else if (questionType === 'matching') {
    if (unit.kind !== 'formula') return null
    const formulaPairs = unit.variables.slice(0, 4).map(variable => ({
      variable,
      leftAssertion: assertionForCanonical(unitLink.assertions, variable.symbol),
      rightAssertion: assertionForCanonical(unitLink.assertions, variable.meaning),
    })).filter((pair): pair is typeof pair & {
      leftAssertion: EvidenceBackedAssertion
      rightAssertion: EvidenceBackedAssertion
    } => Boolean(pair.leftAssertion && pair.rightAssertion))
    if (formulaPairs.length < 2) return null
    answerTarget = {
      kind: 'pairs',
      assertionIds: [...new Set(formulaPairs.flatMap(pair => [
        pair.leftAssertion.assertionId, pair.rightAssertion.assertionId,
      ]))],
      pairTargets: formulaPairs.map(({ variable, leftAssertion, rightAssertion }) => ({
        leftAssertionId: leftAssertion.assertionId,
        rightAssertionId: rightAssertion.assertionId,
        leftCanonical: variable.symbol,
        rightCanonical: variable.meaning,
      })),
    }
  } else {
    // A fill-blank answer must remain a concise canonical field; a complete
    // evidence quote is valid authority but is not a pedagogically sound blank.
    if (questionType === 'fill_blank' && !labelAssertion) return null
    if (questionType === 'short_answer' && authority.source === 'verbatim_evidence') return null
    const answerAssertion = questionType === 'fill_blank' ? labelAssertion! : authority.assertion
    answerTarget = {
      kind: 'single_text',
      canonicalValue: questionType === 'fill_blank' ? unit.label : authority.canonicalValue,
      assertionIds: [answerAssertion.assertionId],
    }
  }
  const groundingAssertionIds = [...new Set(answerTarget.assertionIds)]
  const semanticKey = unit.identity.semanticKey || unit.label
  const relationContext = authorizedRelations.map(item => item.relation.id).sort().join(',') || 'none'
  const assessmentIntent = `${questionType}:${transformationVariant}`
  const candidateId = `qc:${unit.id}:${questionType}:${transformationVariant}:rel=${relationContext}`
  return {
    candidateId,
    intent: `${semanticKey}:${assessmentIntent}:rel=${relationContext}`,
    assessmentIntent,
    cognitiveIntent: cognitiveIntentForDifficulty(difficulty),
    assessmentSemanticIdentity: assessmentSemanticIdentityFor(
      questionType, answerTarget, cognitiveIntentForDifficulty(difficulty),
    ),
    transformationVariant,
    questionType, difficulty,
    sourceUnitIds: [unit.id],
    sourceRelationIds: authorizedRelations.map(r => r.relation.id),
    sourceMaterialId: evidence[0].materialId,
    sourcePage: evidence[0].page,
    unitKind: unit.kind,
    evidence: combinedEvidence,
    evidenceLinks,
    answerTarget,
    groundingTarget: {
      evidenceBackedAssertionIds: groundingAssertionIds,
      sourceUnitIds: [unit.id],
      sourceRelationIds: authorizedRelations.map(r => r.relation.id),
    },
  }
}

function buildAggregateCandidatePlan(
  units: Array<{ unit: KnowledgeUnit; evidence: SourceEvidence[] }>,
  questionType: 'multi_select' | 'matching',
  transformationVariant: string,
  difficulty: QuizDifficulty,
  relations: Array<{ relation: MaterialBrain['relations'][number]; evidence: SourceEvidence[] }> = [],
  diagnostics?: { matchingLeftCollision: boolean },
): QuizCandidatePlan | null {
  const ordered = [...units].sort((a, b) => a.unit.id.localeCompare(b.unit.id))
  const links = ordered.map(item => evidenceLinkForUnit(item.unit, item.evidence, {
    includeVerbatimEvidence: true,
  }))
  const relationLinks = relations.map(item => evidenceLinkForRelation(item.relation, item.evidence))
  if (relationLinks.some(link => !link)) return null
  const unitLinksById = new Map(ordered.flatMap((item, index) => links[index] ? [[item.unit.id, links[index]!]] : []))
  const members = ordered.map(item => {
    const link = unitLinksById.get(item.unit.id)
    const matching = questionType === 'matching' ? groundedMatchingMember(item) : null
    const leftCanonical = matching?.leftCanonical
      || (item.unit.kind === 'definition' ? item.unit.term : item.unit.label)
    const leftAssertion = matching?.leftAssertion || (link ? assertionForCanonical(link.assertions, leftCanonical) : null)
    const labelAssertion = link ? assertionForCanonical(link.assertions, item.unit.label) : null
    const rightAssertion = matching?.rightAssertion || (link ? assertionForCanonical(link.assertions, item.unit.statement) : null)
    const rightCanonical = matching?.rightCanonical || item.unit.statement
    return { item, leftCanonical, rightCanonical, leftAssertion, labelAssertion, rightAssertion }
  })
  const duplicateCanonicalKeys = (values: string[]) => {
    const counts = new Map<string, number>()
    for (const value of values) {
      const normalized = normalizeQuizText(value)
      counts.set(normalized, (counts.get(normalized) || 0) + 1)
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([value]) => value))
  }
  const validMembers = members.filter(member => questionType === 'multi_select'
    ? Boolean(unitLinksById.get(member.item.unit.id)?.assertions.length)
    : Boolean(member.leftAssertion && member.rightAssertion))
  const minimumMembers = questionType === 'multi_select' ? 3 : 2
  if (validMembers.length < minimumMembers) return null
  let eligibleMembers = validMembers
  const multiSelectCanonicals = new Map<typeof validMembers[number], {
    canonicalValue: string
    assertion: EvidenceBackedAssertion
  }>()
  if (questionType === 'multi_select') {
    const primaryCollisions = duplicateCanonicalKeys(validMembers.map(member => member.item.unit.label))
    const resolved = validMembers.map(member => {
      const link = unitLinksById.get(member.item.unit.id)!
      const labelCollides = primaryCollisions.has(normalizeQuizText(member.item.unit.label))
      const primaryAssertion = labelCollides ? null
        : exactAssertionForCanonical(link.assertions, member.item.unit.label)
      const statementAssertion = exactAssertionForCanonical(link.assertions, member.item.unit.statement)
      const evidenceTexts = new Set(member.item.evidence.map(evidenceAuthorityText).map(normalizedPlannerText))
      const evidenceAssertion = link.assertions.find(assertion =>
        evidenceTexts.has(normalizedPlannerText(assertion.text))) || null
      const assertion = primaryAssertion || statementAssertion || evidenceAssertion
      const canonicalValue = assertion?.text || ''
      return { member, canonicalValue, assertion }
    })
    const finalCollisions = duplicateCanonicalKeys(resolved.map(item => item.canonicalValue))
    const survivors = resolved.filter(item => item.assertion
      && !finalCollisions.has(normalizeQuizText(item.canonicalValue)))
    eligibleMembers = survivors.map(item => item.member)
    for (const item of survivors) {
      multiSelectCanonicals.set(item.member, {
        canonicalValue: item.canonicalValue,
        assertion: item.assertion!,
      })
    }
    if (eligibleMembers.length < minimumMembers) return null
  }
  if (questionType === 'matching') {
    const leftCollisionKeys = duplicateCanonicalKeys(validMembers.map(member => member.leftCanonical))
    const rightCollisionKeys = duplicateCanonicalKeys(validMembers.map(member => member.rightCanonical))
    if ((leftCollisionKeys.size > 0 || rightCollisionKeys.size > 0) && diagnostics) diagnostics.matchingLeftCollision = true
    eligibleMembers = validMembers.filter(member =>
      !leftCollisionKeys.has(normalizeQuizText(member.leftCanonical))
      && !rightCollisionKeys.has(normalizeQuizText(member.rightCanonical)))
    if (eligibleMembers.length < minimumMembers) return null
  }
  const validUnits = eligibleMembers.map(member => member.item)
  const unitIds = validUnits.map(item => item.unit.id)
  const identity = unitIds.join('+')
  const relationIds = relations.map(item => item.relation.id).sort()
  const relationIdentity = relationIds.length ? `:rel=${relationIds.join('+')}` : ''
  const assessmentIntent = `${questionType}:${transformationVariant}:aggregate=${identity}${relationIdentity}`
  const answerTarget: AnswerTarget = questionType === 'multi_select'
    ? {
        kind: 'multi_text',
        canonicalValues: eligibleMembers.map(member => multiSelectCanonicals.get(member)!.canonicalValue),
        assertionIds: eligibleMembers.map(member => multiSelectCanonicals.get(member)!.assertion.assertionId),
      }
    : {
        kind: 'pairs',
        assertionIds: [...new Set(eligibleMembers.flatMap(member => [
          member.leftAssertion!.assertionId, member.rightAssertion!.assertionId,
        ]))],
        pairTargets: eligibleMembers.map(member => ({
          leftAssertionId: member.leftAssertion!.assertionId,
          rightAssertionId: member.rightAssertion!.assertionId,
          leftCanonical: member.leftCanonical,
          rightCanonical: member.rightCanonical,
        })),
      }
  return {
    candidateId: `qc:aggregate:${identity}:${questionType}:${transformationVariant}${relationIdentity}`,
    intent: `aggregate:${identity}:${assessmentIntent}`,
    assessmentIntent,
    cognitiveIntent: cognitiveIntentForDifficulty(difficulty),
    assessmentSemanticIdentity: assessmentSemanticIdentityFor(
      questionType, answerTarget, cognitiveIntentForDifficulty(difficulty),
    ),
    transformationVariant,
    questionType,
    difficulty,
    sourceUnitIds: unitIds,
    sourceRelationIds: relationIds,
    sourceMaterialId: validUnits[0].evidence[0].materialId,
    sourcePage: validUnits[0].evidence[0].page,
    unitKind: validUnits[0].unit.kind,
    evidence: dedupeSourceEvidence([...validUnits.flatMap(item => item.evidence), ...relations.flatMap(item => item.evidence)]),
    evidenceLinks: [
      ...eligibleMembers.map(member => unitLinksById.get(member.item.unit.id)),
      ...relationLinks,
    ].filter((link): link is NonNullable<typeof link> => Boolean(link)),
    answerTarget,
    groundingTarget: {
      evidenceBackedAssertionIds: answerTarget.assertionIds,
      sourceUnitIds: unitIds,
      sourceRelationIds: relationIds,
    },
  }
}

/**
 * Scarcity-first joint allocator.
 *
 * Bipartite matching between requested-count slots and candidates,
 * where each iteration:
 *   1. Chooses the SCARCEST type T (fewest remaining transformations among
 *      user-selected types with remaining target > 0). This dominates.
 *   2. Chooses the transformation whose source has the fewest compatible
 *      selected types. This protects specialized transformations.
 *   3. Breaks ties by: bucket coverage (least-used material:page),
 *      pedagogical fitness, importance rank, then stable material/page/unitId.
 *
 * This guarantees the T5 adversarial case (2 MC-only + 2 MC+MATCHING units,
 * N=4, types=[MC,MATCHING]) yields 2 MC + 2 MATCHING deterministically.
 */
function allocatePlan(
  brain: MaterialBrain,
  config: QuizConfig,
  allocCandidates: AllocCandidate[],
  options: PlanQuizOptions = {},
): {
  slots: QuizPlanSlot[]
  candidatePoolBySlot: Record<string, QuizCandidatePlan[]>
  plannedQuestions: PlannedQuizQuestion[]
  globalCandidatePool: QuizCandidatePlan[]
  typeCapabilityDiagnostics: QuizPlan['typeCapabilityDiagnostics']
  noveltyContext?: NonNullable<QuizPlan['noveltyContext']>
} {
  const authorized = new Map(brain.scope.materials.map(item => [item.materialId, new Set(item.selectedPages)]))
  const selectedTypes = [...config.questionTypes]
  const transformations = allocCandidates.flatMap(candidate => candidate.compatible.flatMap(questionType =>
    TRANSFORMATION_VARIANTS[questionType].map((transformationVariant, variantOrder) => ({
      candidate,
      questionType,
      transformationVariant,
      variantOrder,
      plan: buildCandidatePlan(
        brain, authorized, candidate.unit, candidate.evidence,
        questionType, transformationVariant, config.difficulty,
      ),
    })).filter((item): item is typeof item & { plan: QuizCandidatePlan } => Boolean(item.plan))))

  const byCanonicalSubject = new Map<string, AllocCandidate[]>()
  for (const candidate of allocCandidates) {
    const subject = normalizeSemanticText(candidate.unit.identity?.canonicalSubject || '')
    if (!subject) continue
    const group = byCanonicalSubject.get(subject) || []
    group.push(candidate)
    byCanonicalSubject.set(subject, group)
  }
  let hasMatchingCanonicalCluster = false
  let hasMultiSelectCanonicalCluster = false
  let hasMatchingLeftCollision = false
  for (const group of byCanonicalSubject.values()) {
    const ordered = [...group].sort((a, b) => a.unit.id.localeCompare(b.unit.id))
    if (selectedTypes.includes('multi_select') && ordered.length >= 3) {
      const members = ordered.slice(0, 5)
      for (const [variantOrder, transformationVariant] of TRANSFORMATION_VARIANTS.multi_select.entries()) {
        const plan = buildAggregateCandidatePlan(members, 'multi_select', transformationVariant, config.difficulty)
        if (plan) transformations.push({
          candidate: { ...members[0], compatible: ['multi_select'], rank: Math.max(...members.map(item => item.rank)) },
          questionType: 'multi_select', transformationVariant, variantOrder, plan,
        })
        if (plan) hasMultiSelectCanonicalCluster = true
      }
    }
    const structuredMatching = ordered.filter(item => item.unit.kind === 'definition' || item.unit.kind === 'terminology')
    if (selectedTypes.includes('matching') && structuredMatching.length >= 2) {
      const members = structuredMatching.slice(0, 4)
      for (const [variantOrder, transformationVariant] of TRANSFORMATION_VARIANTS.matching.entries()) {
        const diagnostic = { matchingLeftCollision: false }
        const plan = buildAggregateCandidatePlan(members, 'matching', transformationVariant, config.difficulty, [], diagnostic)
        if (diagnostic.matchingLeftCollision) hasMatchingLeftCollision = true
        if (plan) transformations.push({
          candidate: { ...members[0], compatible: ['matching'], rank: Math.max(...members.map(item => item.rank)) },
          questionType: 'matching', transformationVariant, variantOrder, plan,
        })
        if (plan) hasMatchingCanonicalCluster = true
      }
    }
  }
  if (selectedTypes.includes('matching')) {
    const byUnitId = new Map(allocCandidates.map(candidate => [candidate.unit.id, candidate]))
    for (const relation of brain.relations) {
      const endpoints = [byUnitId.get(relation.fromUnitId), byUnitId.get(relation.toUnitId)]
        .filter((item): item is AllocCandidate => Boolean(item))
      if (endpoints.length !== 2) continue
      const evidence = relationEvidence(relation)
      if (!evidence.length || !evidence.every(item => {
        const pages = authorized.get(item.materialId)
        return Boolean(pages && (pages.size === 0 || pages.has(item.page)))
      })) continue
      for (const [variantOrder, transformationVariant] of TRANSFORMATION_VARIANTS.matching.entries()) {
        const diagnostic = { matchingLeftCollision: false }
        const plan = buildAggregateCandidatePlan(endpoints, 'matching', transformationVariant, config.difficulty, [{ relation, evidence }], diagnostic)
        if (diagnostic.matchingLeftCollision) hasMatchingLeftCollision = true
        if (plan) transformations.push({
          candidate: { ...endpoints[0], compatible: ['matching'], rank: Math.max(...endpoints.map(item => item.rank)) },
          questionType: 'matching', transformationVariant, variantOrder, plan,
        })
      }
    }

    const resolvedGlobalMembers = allocCandidates.flatMap(candidate => {
      const member = groundedMatchingMember(candidate)
      return member ? [{ candidate, member }] : []
    })
    const globalLeftCounts = new Map<string, number>()
    const globalRightCounts = new Map<string, number>()
    for (const { member } of resolvedGlobalMembers) {
      const left = normalizeQuizText(member.leftCanonical)
      const right = normalizeQuizText(member.rightCanonical)
      globalLeftCounts.set(left, (globalLeftCounts.get(left) || 0) + 1)
      globalRightCounts.set(right, (globalRightCounts.get(right) || 0) + 1)
    }
    const globalPairMembers = resolvedGlobalMembers
      .filter(({ member }) => globalLeftCounts.get(normalizeQuizText(member.leftCanonical)) === 1
        && globalRightCounts.get(normalizeQuizText(member.rightCanonical)) === 1)
      .map(({ candidate }) => candidate)
      .sort((a, b) => a.unit.id.localeCompare(b.unit.id))
    if (globalPairMembers.length < resolvedGlobalMembers.length) hasMatchingLeftCollision = true
    if (globalPairMembers.length >= 2) {
      const subsetKeys = new Set<string>()
      const subsets: AllocCandidate[][] = []
      const collectSubsets = (size: number, start: number, selected: AllocCandidate[]) => {
        if (subsets.length >= 100) return
        if (selected.length === size) {
          const key = selected.map(item => item.unit.id).join('|')
          if (!subsetKeys.has(key)) { subsetKeys.add(key); subsets.push([...selected]) }
          return
        }
        for (let index = start; index < globalPairMembers.length; index += 1) {
          selected.push(globalPairMembers[index])
          collectSubsets(size, index + 1, selected)
          selected.pop()
          if (subsets.length >= 100) return
        }
      }
      for (let size = Math.min(4, globalPairMembers.length); size >= 2; size -= 1) {
        collectSubsets(size, 0, [])
      }
      for (const [index, members] of subsets.entries()) {
        const transformationVariant = TRANSFORMATION_VARIANTS.matching[index % TRANSFORMATION_VARIANTS.matching.length]
        const diagnostic = { matchingLeftCollision: false }
        const plan = buildAggregateCandidatePlan(members, 'matching', transformationVariant, config.difficulty, [], diagnostic)
        if (diagnostic.matchingLeftCollision) hasMatchingLeftCollision = true
        if (!plan) continue
        transformations.push({
          candidate: { ...members[0], compatible: ['matching'], rank: Math.max(...members.map(item => item.rank)) },
          questionType: 'matching', transformationVariant,
          variantOrder: index % TRANSFORMATION_VARIANTS.matching.length,
          plan,
        })
        hasMatchingCanonicalCluster = true
      }
    }
  }

  // Matching capacity counts distinct grounded pair sets, not cosmetic transformation variants.
  const seenMatchingPairSets = new Set<string>()
  const structurallyDistinctTransformations = transformations.filter(item => {
    if (item.questionType !== 'matching' || item.plan.answerTarget.kind !== 'pairs') return true
    const key = (item.plan.answerTarget.pairTargets || []).map(pair =>
      `${normalizeQuizText(pair.leftCanonical)}=>${normalizeQuizText(pair.rightCanonical)}`).sort().join('|')
    if (!key || seenMatchingPairSets.has(key)) return false
    seenMatchingPairSets.add(key)
    return true
  })
  transformations.splice(0, transformations.length, ...structurallyDistinctTransformations)

  // Capacity is the number of legitimate transformations, not source units.
  const recentKnowledgeTargetsToAvoid = options.history
    ? [...new Set([...options.history.entries].reverse().flatMap(entry => [...entry.knowledgeTargetIds].reverse()))].slice(0, 10)
    : []
  if (recentKnowledgeTargetsToAvoid.length) {
    for (const transformation of transformations) {
      transformation.plan.recentKnowledgeTargetsToAvoid = [...recentKnowledgeTargetsToAvoid]
    }
  }
  const capacity = new Map<QuizQuestionType, number>()
  for (const type of selectedTypes) {
    capacity.set(type, transformations.filter(item => item.questionType === type).length)
  }
  const typeCapabilityDiagnostics: QuizPlan['typeCapabilityDiagnostics'] = {}
  for (const type of selectedTypes) {
    const available = capacity.get(type) || 0
    if (available > 0) {
      typeCapabilityDiagnostics[type] = { capacity: available }
      continue
    }
    if (type !== 'matching' && type !== 'multi_select') {
      typeCapabilityDiagnostics[type] = { capacity: available, reason: 'no eligible grounded units for this type' }
      continue
    }
    const reasons: string[] = []
    const minimumMembers = type === 'matching' ? 2 : 3
    const hasCanonicalCluster = type === 'matching' ? hasMatchingCanonicalCluster : hasMultiSelectCanonicalCluster
    if (!hasCanonicalCluster) reasons.push(type === 'matching'
      ? 'no global matching pool with >=2 unique grounded pairs'
      : `no canonicalSubject cluster with >=${minimumMembers} valid members`)
    if (type === 'matching' && hasMatchingLeftCollision) {
      reasons.push('no matching group with >=2 uniquely identifiable grounded members')
    }
    if (brain.relations.length === 0) reasons.push('no Brain relations available')
    if (type === 'matching' && !allocCandidates.some(item => item.unit.kind === 'formula' && item.unit.variables.length >= 2)) {
      reasons.push('no formula unit with >=2 variables')
    }
    typeCapabilityDiagnostics[type] = { capacity: available, reason: reasons.join('; ') || `no eligible grounded ${type} transformations` }
  }
  const globalCandidatePool = [...new Map(transformations.map(item => [item.plan.candidateId, item.plan])).values()]
  if (options.coverageOnly) {
    return { slots: [], candidatePoolBySlot: {}, plannedQuestions: [], globalCandidatePool, typeCapabilityDiagnostics }
  }
  const remainingTarget = allocateQuizTypeTargets(
    config.questionCount, selectedTypes, capacity,
    options.allocationSeed || quizAllocationSeed(config.questionCount, selectedTypes, config.difficulty),
  )

  const slots: QuizPlanSlot[] = []
  const candidatePoolBySlot: Record<string, QuizCandidatePlan[]> = {}
  const plannedQuestions: PlannedQuizQuestion[] = []
  const usedIntents = new Set<string>()
  const repeatDepthByKnowledgeTarget = new Map<string, number>()
  const repeatDepthByAssessmentIdentity = new Map<string, number>()
  const repeatDepthByUnit = new Map<string, number>()
  const repeatDepthByCanonicalSubject = new Map<string, number>()
  const bucketUsage = new Map<string, number>()
  const ranks = new Map(brain.units.map(unit => [unit.id, quizUnitRank(unit)]))
  const canonicalSubjectByUnit = new Map(brain.units.map(unit => [unit.id, unit.identity.canonicalSubject]))
  const historyCounts = new Map<string, number>()
  const assessmentHistoryCounts = new Map<string, number>()
  if (options.generationId && options.history) {
    for (const entry of options.history.entries) {
      for (const target of entry.knowledgeTargetIds) historyCounts.set(target, (historyCounts.get(target) || 0) + 1)
      for (const identity of entry.assessmentSemanticIdentities || []) {
        assessmentHistoryCounts.set(identity, (assessmentHistoryCounts.get(identity) || 0) + 1)
      }
    }
  }
  const noveltyRankingContext: QuizCandidateNoveltyRankingContext = {
    historyCounts, assessmentHistoryCounts, generationId: options.generationId,
    repeatDepthByKnowledgeTarget, repeatDepthByAssessmentIdentity,
    repeatDepthByUnit, repeatDepthByCanonicalSubject, bucketUsage, ranks,
    canonicalSubjectByUnit, selectedTypes,
  }

  const availableTransformations = (type?: QuizQuestionType) => transformations.filter(item =>
    (!type || item.questionType === type) && !usedIntents.has(item.plan.intent))

  const remainingCapacityForType = (type: QuizQuestionType): number =>
    availableTransformations(type).length

  const nextType = (): QuizQuestionType | null => {
    const eligible = selectedTypes
      .filter(t => (remainingTarget.get(t) || 0) > 0 && remainingCapacityForType(t) > 0)
    if (!eligible.length) return null
    eligible.sort((a, b) => {
      const ca = remainingCapacityForType(a)
      const cb = remainingCapacityForType(b)
      if (ca !== cb) return ca - cb                                // scarcest FIRST
      const da = remainingTarget.get(a) || 0
      const db = remainingTarget.get(b) || 0
      if (da !== db) return db - da                                // biggest deficit next
      return selectedTypes.indexOf(a) - selectedTypes.indexOf(b)   // stable
    })
    return eligible[0]
  }

  const sortTransformations = <T extends typeof transformations[number]>(pool: T[]): T[] => pool.sort((a, b) => {
      const scA = a.candidate.compatible.length
      const scB = b.candidate.compatible.length
      if (scA !== scB) return scA - scB
      return compareQuizCandidateNovelty(a.plan, b.plan, noveltyRankingContext)
    })

  const pickCandidateForType = (type: QuizQuestionType): typeof transformations[number] | null => {
    const pool = availableTransformations(type)
    if (!pool.length) return null
    return sortTransformations(pool)[0]
  }

  for (let order = 0; order < config.questionCount; order += 1) {
    const chosenType = nextType()
    if (!chosenType) break
    const chosen = pickCandidateForType(chosenType)
    if (!chosen) {
      remainingTarget.set(chosenType, 0)
      order -= 1
      continue
    }
    const primary = chosen.plan
    const slotId = `qs:${order + 1}:${chosen.candidate.unit.id}:${chosenType}:${chosen.transformationVariant}`

    // Recovery preserves the preferred type across every unused transformation
    // before considering another user-selected compatible type.
    const sameType = sortTransformations(availableTransformations(chosenType)
      .filter(item => item.plan.candidateId !== primary.candidateId))
    const otherSelected = sortTransformations(availableTransformations()
      .filter(item => item.questionType !== chosenType && selectedTypes.includes(item.questionType)))
    const alternates: QuizCandidatePlan[] = [primary, ...sameType.map(item => item.plan), ...otherSelected.map(item => item.plan)]

    // Dedupe by candidateId, preserving first occurrence.
    const seenAlt = new Set<string>()
    const dedupedAlternates = alternates.filter(c => {
      if (seenAlt.has(c.candidateId)) return false
      seenAlt.add(c.candidateId); return true
    })

    slots.push({
      slotId, order,
      questionType: chosenType,
      difficulty: config.difficulty,
      primaryCandidateId: primary.candidateId,
    })
    candidatePoolBySlot[slotId] = dedupedAlternates
    plannedQuestions.push({
      id: `quiz-plan:${order + 1}:${chosen.candidate.unit.id}:${chosen.transformationVariant}`,
      slotId,
      candidateId: primary.candidateId,
      order,
      intent: primary.intent,
      assessmentIntent: primary.assessmentIntent,
      cognitiveIntent: primary.cognitiveIntent,
      assessmentSemanticIdentity: primary.assessmentSemanticIdentity,
      ...(primary.recentKnowledgeTargetsToAvoid ? {
        recentKnowledgeTargetsToAvoid: [...primary.recentKnowledgeTargetsToAvoid],
      } : {}),
      transformationVariant: primary.transformationVariant,
      questionType: chosenType,
      difficulty: config.difficulty,
      sourceUnitIds: primary.sourceUnitIds,
      sourceRelationIds: primary.sourceRelationIds,
      sourceMaterialId: primary.sourceMaterialId,
      sourcePage: primary.sourcePage,
      unitKind: primary.unitKind,
      evidence: primary.evidence,
      evidenceLinks: primary.evidenceLinks,
      answerTarget: primary.answerTarget,
      groundingTarget: primary.groundingTarget,
    })
    usedIntents.add(primary.intent)
    const knowledgeTargetId = quizKnowledgeTargetId(primary.sourceUnitIds, primary.sourceRelationIds)
    repeatDepthByKnowledgeTarget.set(knowledgeTargetId, (repeatDepthByKnowledgeTarget.get(knowledgeTargetId) || 0) + 1)
    const assessmentIdentity = quizAssessmentSemanticIdentity(primary)
    repeatDepthByAssessmentIdentity.set(
      assessmentIdentity, (repeatDepthByAssessmentIdentity.get(assessmentIdentity) || 0) + 1,
    )
    repeatDepthByUnit.set(chosen.candidate.unit.id, (repeatDepthByUnit.get(chosen.candidate.unit.id) || 0) + 1)
    const canonicalSubject = chosen.candidate.unit.identity.canonicalSubject
    repeatDepthByCanonicalSubject.set(canonicalSubject, (repeatDepthByCanonicalSubject.get(canonicalSubject) || 0) + 1)
    bucketUsage.set(chosen.candidate.materialPageKey, (bucketUsage.get(chosen.candidate.materialPageKey) || 0) + 1)
    remainingTarget.set(chosenType, Math.max(0, (remainingTarget.get(chosenType) || 0) - 1))
  }

  return {
    slots, candidatePoolBySlot, plannedQuestions, globalCandidatePool, typeCapabilityDiagnostics,
    ...(options.generationId ? {
      noveltyContext: {
        generationId: options.generationId,
        historyCounts: Object.fromEntries(historyCounts),
        assessmentHistoryCounts: Object.fromEntries(assessmentHistoryCounts),
      },
    } : {}),
  }
}

export function planQuiz(brain: MaterialBrain, rawConfig: unknown, options: PlanQuizOptions = {}): QuizPlan {
  const config = normalizeQuizConfig(rawConfig)
  const allocCandidates = buildAllocCandidates(brain, config)

  if (!allocCandidates.length) throw new Error('INSUFFICIENT_KNOWLEDGE')

  const { slots, candidatePoolBySlot, plannedQuestions, globalCandidatePool, typeCapabilityDiagnostics, noveltyContext } = allocatePlan(brain, config, allocCandidates, options)
  if (plannedQuestions.length < config.questionCount) {
    const onlySelectedType = config.questionTypes.length === 1 ? config.questionTypes[0] : undefined
    const unavailableType = onlySelectedType
      ? typeCapabilityDiagnostics[onlySelectedType]
      : undefined
    throw new Error(unavailableType?.capacity === 0 && unavailableType.reason
      ? `INSUFFICIENT_KNOWLEDGE:${onlySelectedType}: ${unavailableType.reason}`
      : 'INSUFFICIENT_KNOWLEDGE')
  }

  return {
    brainFingerprint: brain.scope.fingerprint,
    config,
    configFingerprint: quizConfigFingerprint(config),
    plannedQuestions,
    slots,
    candidatePoolBySlot,
    globalCandidatePool,
    typeCapabilityDiagnostics,
    ...(noveltyContext ? { noveltyContext } : {}),
  }
}

function buildAllocCandidates(brain: MaterialBrain, config: QuizConfig): AllocCandidate[] {
  const authorized = new Map(brain.scope.materials.map(item => [item.materialId, new Set(item.selectedPages)]))
  const raw = brain.units
    .filter(unit => !unit.supersededBy)
    .map(unit => ({ unit, evidence: unitEvidence(unit) }))
    .filter(item => item.evidence.length > 0)
    .filter(item => item.evidence.every(evidence => {
      const pages = authorized.get(evidence.materialId)
      return Boolean(pages && (pages.size === 0 || pages.has(evidence.page)))
    }))
    .sort((a, b) => {
      const rank = quizUnitRank(b.unit) - quizUnitRank(a.unit)
      if (rank) return rank
      const ae = a.evidence[0]; const be = b.evidence[0]
      return ae.materialId.localeCompare(be.materialId)
        || ae.page - be.page
        || a.unit.id.localeCompare(b.unit.id)
    })

  if (!raw.length) return []

  const deduped = semanticDedupeCandidates(raw)
  return deduped
    .filter(item => Boolean(evidenceLinkForUnit(item.unit, item.evidence, { includeVerbatimEvidence: true })))
    .map(item => {
      const hasGroundedRelation = brain.relations.some(relation => {
        if (relation.fromUnitId !== item.unit.id && relation.toUnitId !== item.unit.id) return false
        const evidence = relationEvidence(relation)
        return evidence.length > 0 && evidence.every(source => {
          const pages = authorized.get(source.materialId)
          return Boolean(pages && (pages.size === 0 || pages.has(source.page)))
        }) && Boolean(evidenceLinkForRelation(relation, evidence))
      })
      const compatible = typeFitness(item.unit.kind, config.questionTypes)
        .filter(type => unitSupportsType(item.unit, type, hasGroundedRelation))
      return {
        unit: item.unit,
        evidence: item.evidence,
        compatible,
        rank: quizUnitRank(item.unit),
        materialPageKey: `${item.evidence[0].materialId}:${item.evidence[0].page}`,
      }
    })
    .filter(candidate => candidate.compatible.length > 0
      || config.questionTypes.includes('multi_select')
      || config.questionTypes.includes('matching'))
}

function atomicCoverageTargets(candidate: QuizCandidatePlan): string[] {
  return [
    ...candidate.sourceUnitIds.map(unitId => quizKnowledgeTargetId([unitId], [])),
    ...candidate.sourceRelationIds.map(relationId => quizKnowledgeTargetId([], [relationId])),
  ].filter(Boolean).sort()
}

interface QuizSourceRegion {
  id: string
  materialId: string
  pages: number[]
  targetIds: string[]
}

/**
 * Deterministic source-locality layer. Its density budget comes from the
 * smallest legitimate aggregate assessment available in this exact pool;
 * it is not a pages-per-question constant. Atomic-only pools use one target
 * per region, which preserves the existing one-question-per-target result.
 */
function buildQuizSourceRegions(
  brain: MaterialBrain,
  candidates: Array<{ candidate: QuizCandidatePlan; targets: string[] }>,
): { regions: QuizSourceRegion[]; assessablePageCount: number } {
  const aggregateWidths = candidates.map(item => item.targets.length).filter(length => length > 1)
  const targetBudget = aggregateWidths.length ? Math.min(...aggregateWidths) : 1
  const units = new Map(brain.units.map(unit => [unit.id, unit]))
  const relations = new Map(brain.relations.map(relation => [relation.id, relation]))
  const refsByTarget = new Map<string, Array<{ materialId: string; page: number }>>()
  for (const item of candidates) {
    for (const target of item.targets) {
      const source = units.get(target) || relations.get(target)
      const refs = [...(source?.provenance || []), ...(source?.evidence || [])]
        .map(ref => ({ materialId: ref.materialId, page: ref.page }))
      const existing = refsByTarget.get(target) || []
      refsByTarget.set(target, [...new Map([...existing, ...refs].map(ref => [`${ref.materialId}:${ref.page}`, ref])).values()])
    }
  }
  const assessablePages = new Set<string>()
  const targetsByPrimaryPage = new Map<string, string[]>()
  for (const [target, refs] of refsByTarget) {
    const sorted = [...refs].sort((a, b) => a.materialId.localeCompare(b.materialId) || a.page - b.page)
    for (const ref of sorted) assessablePages.add(`${ref.materialId}:${ref.page}`)
    const primary = sorted[0]
    if (!primary) continue
    const key = `${primary.materialId}:${primary.page}`
    targetsByPrimaryPage.set(key, [...(targetsByPrimaryPage.get(key) || []), target].sort())
  }

  const entries = [...targetsByPrimaryPage.entries()].map(([key, targets]) => {
    const separator = key.lastIndexOf(':')
    return { materialId: key.slice(0, separator), page: Number(key.slice(separator + 1)), targets }
  }).sort((a, b) => a.materialId.localeCompare(b.materialId) || a.page - b.page)
  const regions: QuizSourceRegion[] = []
  let current: QuizSourceRegion | null = null
  const flush = () => {
    if (!current) return
    current.id = `source-region:${regions.length}:${current.materialId}:${current.pages[0]}-${current.pages[current.pages.length - 1]}`
    regions.push(current)
    current = null
  }
  for (const entry of entries) {
    for (const target of entry.targets) {
      const contiguous = current?.materialId === entry.materialId
        && entry.page - current.pages[current.pages.length - 1] <= 1
      if (current && (!contiguous || current.targetIds.length >= targetBudget)) flush()
      if (!current) current = { id: '', materialId: entry.materialId, pages: [], targetIds: [] }
      if (!current.pages.includes(entry.page)) current.pages.push(entry.page)
      current.targetIds.push(target)
    }
  }
  flush()
  return { regions, assessablePageCount: assessablePages.size }
}

/** Planning-only assessable coverage. It never generates wording or reads generation history. */
export function analyzeQuizCoverage(brain: MaterialBrain, rawConfig: unknown): QuizCoverageAnalysis {
  const config = normalizeQuizConfig(rawConfig)
  const allocCandidates = buildAllocCandidates(brain, config)
  if (!allocCandidates.length) return {
    recommendedQuestionCount: 0, suggestedQuestionCount: 0,
    totalAssessableTargets: 0, coveredTargetCount: 0, estimatedCoveragePercent: 0,
    fullCoverageAchievableInSingleQuiz: true, maxSingleQuizCoveragePercent: 0,
    representedSupportedTypeCount: 0, supportedSelectedTypeCount: 0,
    groundedAssertionsConsidered: 0,
    assessablePageCount: 0, sourceRegionCount: 0,
    knowledgeCoverageMinimum: 0, sourceRegionCoverageMinimum: 0, supportedTypeMinimum: 0,
    supportedSelectedTypes: [],
    unsupportedSelectedTypes: config.questionTypes.map(type => ({ type, reason: 'no eligible grounded units for this type' })),
  }

  const allocation = allocatePlan(brain, config, allocCandidates, { coverageOnly: true })
  const supportedSelectedTypes = config.questionTypes.filter(type => (allocation.typeCapabilityDiagnostics[type]?.capacity || 0) > 0)
  const unsupportedSelectedTypes = config.questionTypes
    .filter(type => !supportedSelectedTypes.includes(type))
    .map(type => ({ type, reason: allocation.typeCapabilityDiagnostics[type]?.reason }))

  // Cosmetic transformations never add coverage: one structural candidate per
  // question type + exact set of authorized units/relations is enough.
  const structural = new Map<string, { candidate: QuizCandidatePlan; targets: string[] }>()
  for (const candidate of allocation.globalCandidatePool) {
    const targets = atomicCoverageTargets(candidate)
    if (!targets.length) continue
    const key = `${candidate.questionType}:${targets.join('|')}`
    if (!structural.has(key)) structural.set(key, { candidate, targets })
  }
  const candidates = [...structural.values()].sort((a, b) =>
    b.targets.length - a.targets.length
      || config.questionTypes.indexOf(a.candidate.questionType) - config.questionTypes.indexOf(b.candidate.questionType)
      || a.candidate.candidateId.localeCompare(b.candidate.candidateId))
  const sourceCoverage = buildQuizSourceRegions(brain, candidates)
  const allTargets = new Set(candidates.flatMap(item => item.targets))
  const uncovered = new Set(allTargets)
  const selected: typeof candidates = []
  const selectedKeys = new Set<string>()
  const representedTypes = new Set<QuizQuestionType>()

  const choose = (pool: typeof candidates) => [...pool].sort((a, b) => {
    const gainA = a.targets.filter(target => uncovered.has(target)).length
    const gainB = b.targets.filter(target => uncovered.has(target)).length
    const missingTypeA = representedTypes.has(a.candidate.questionType) ? 0 : 1
    const missingTypeB = representedTypes.has(b.candidate.questionType) ? 0 : 1
    return gainB - gainA || missingTypeB - missingTypeA || b.targets.length - a.targets.length
      || a.candidate.candidateId.localeCompare(b.candidate.candidateId)
  })[0]
  const commit = (item: typeof candidates[number] | undefined) => {
    if (!item) return
    const key = `${item.candidate.questionType}:${item.targets.join('|')}`
    if (selectedKeys.has(key)) return
    selectedKeys.add(key); selected.push(item)
    representedTypes.add(item.candidate.questionType)
    for (const target of item.targets) uncovered.delete(target)
  }

  // Coverage gain dominates; an unrepresented supported type is the first tie-break.
  while (uncovered.size > 0) {
    const remaining = candidates.filter(item => !selectedKeys.has(`${item.candidate.questionType}:${item.targets.join('|')}`)
      && item.targets.some(target => uncovered.has(target)))
    if (!remaining.length) break
    commit(choose(remaining))
  }
  const knowledgeCoverageMinimum = selected.length
  // If the recommendation permits K supported types, retain the product's
  // existing one-slot-per-supported-type contract without inventing capacity.
  for (const type of supportedSelectedTypes.filter(type => !representedTypes.has(type))) {
    commit(choose(candidates.filter(item => item.candidate.questionType === type
      && !selectedKeys.has(`${type}:${item.targets.join('|')}`))))
  }

  const sourceRegionCoverageMinimum = sourceCoverage.regions.length
  const supportedTypeMinimum = selected.length
  const recommendationMinimum = Math.max(
    knowledgeCoverageMinimum,
    sourceRegionCoverageMinimum,
    supportedTypeMinimum,
  )
  while (selected.length < recommendationMinimum) {
    const regionUse = new Map(sourceCoverage.regions.map(region => [region.id, 0]))
    for (const item of selected) {
      const targetSet = new Set(item.targets)
      for (const region of sourceCoverage.regions) {
        if (region.targetIds.some(target => targetSet.has(target))) {
          regionUse.set(region.id, (regionUse.get(region.id) || 0) + 1)
        }
      }
    }
    const remaining = candidates.filter(item => !selectedKeys.has(`${item.candidate.questionType}:${item.targets.join('|')}`))
    if (!remaining.length) break
    const next = [...remaining].sort((a, b) => {
      const regionScore = (item: typeof candidates[number]) => Math.min(
        ...sourceCoverage.regions
          .filter(region => region.targetIds.some(target => item.targets.includes(target)))
          .map(region => regionUse.get(region.id) || 0),
      )
      return regionScore(a) - regionScore(b)
        || a.targets.length - b.targets.length
        || a.candidate.candidateId.localeCompare(b.candidate.candidateId)
    })[0]
    commit(next)
  }

  const withinCount = selected.slice(0, config.questionCount)
  const covered = new Set(withinCount.flatMap(item => item.targets))
  const withinSingleQuizLimit = selected.slice(0, 100)
  const maxSingleQuizCovered = new Set(withinSingleQuizLimit.flatMap(item => item.targets))
  const representedSupportedTypes = new Set(withinCount.map(item => item.candidate.questionType)
    .filter(type => supportedSelectedTypes.includes(type)))
  const fullCoverageAchievableInSingleQuiz = maxSingleQuizCovered.size === allTargets.size
    && supportedSelectedTypes.every(type => withinSingleQuizLimit.some(item => item.candidate.questionType === type))
    && recommendationMinimum <= 100
  return {
    recommendedQuestionCount: recommendationMinimum,
    suggestedQuestionCount: Math.min(100, recommendationMinimum),
    totalAssessableTargets: allTargets.size,
    coveredTargetCount: covered.size,
    estimatedCoveragePercent: allTargets.size ? Math.round((covered.size / allTargets.size) * 100) : 0,
    fullCoverageAchievableInSingleQuiz,
    maxSingleQuizCoveragePercent: allTargets.size
      ? Math.round((maxSingleQuizCovered.size / allTargets.size) * 100) : 0,
    representedSupportedTypeCount: representedSupportedTypes.size,
    supportedSelectedTypeCount: supportedSelectedTypes.length,
    groundedAssertionsConsidered: new Set(allocCandidates.map(item => item.unit.id)).size,
    assessablePageCount: sourceCoverage.assessablePageCount,
    sourceRegionCount: sourceCoverage.regions.length,
    knowledgeCoverageMinimum,
    sourceRegionCoverageMinimum,
    supportedTypeMinimum,
    supportedSelectedTypes,
    unsupportedSelectedTypes,
  }
}
