import { createHash } from 'crypto'
import { MATERIAL_ENJOYER_ACADEMIC_VERSION } from '../../adaptive/materialEnjoyer'
import { getMaterialResults, insertImmutableQuizResult } from '../../materials/repository'
import type { MaterialResult } from '../../materials/types'
import type { QuizConfig } from './types'
import type { QuizQuestionType } from '../../types/quiz'
import type {
  EnjoyerAssessmentTarget,
  EnjoyerAssessmentUniverse,
  EnjoyerGroundedQuizQuestion,
  EnjoyerQuizArtifact,
  EnjoyerQuizCoverage,
} from './enjoyer'

export const QUIZ_COVERAGE_CONTRACT_VERSION = 1

export type QuizEvidenceOutcome = 'correct' | 'partial' | 'incorrect' | 'unresolved'
export type QuizCompletionReason = 'requested_limit_reached' | 'scope_exhausted' | 'quality_exhausted'

export interface QuizTargetEvidence {
  questionId: string
  targetId: string
  questionType: QuizQuestionType
  answered: true
  score: number | null
  outcome: QuizEvidenceOutcome
}

export interface QuizCompletionResult {
  schemaVersion: 'quiz-completion-1'
  coverageContractVersion: number
  scopeFingerprint: string
  sourceSelectionFingerprint: string
  universeFingerprint: string
  artifactIdentity: string
  generationId: string
  submissionHash: string
  completedAt: string
  evidence: QuizTargetEvidence[]
}

export interface QuizTargetProgress {
  targetId: string
  attempts: number
  covered: boolean
  recentScore: number | null
  latestOutcome: QuizEvidenceOutcome | null
  lastAssessedAt: string | null
  recentTypes: QuizQuestionType[]
}

export interface QuizProgressiveCoverage {
  scopeFingerprint: string
  universeFingerprint: string
  totalTargets: number
  coveredTargetIds: string[]
  uncoveredTargetIds: string[]
  coveredTargetCount: number
  coveragePercent: number
  mode: 'first_pass' | 'practice'
  targets: Record<string, QuizTargetProgress>
}

export interface PublicQuizCoverageDto {
  totalAssessableTargets: number
  coveredTargetCount: number
  uncoveredTargetCount: number
  estimatedCoveragePercent: number
  mode: 'first_pass' | 'practice'
}

export function serializePublicQuizCoverage(
  coverage: QuizProgressiveCoverage | EnjoyerQuizCoverage | Partial<PublicQuizCoverageDto> | null | undefined,
  fallbackUniverse?: EnjoyerAssessmentUniverse,
): PublicQuizCoverageDto {
  const fallbackTotal = Number(fallbackUniverse?.targets?.length || 0)
  const rawTotal = (coverage as any)?.totalAssessableTargets
    ?? (coverage as any)?.totalTargets
    ?? (Array.isArray((coverage as any)?.coveredTargetIds) && Array.isArray((coverage as any)?.uncoveredTargetIds)
      ? (coverage as any).coveredTargetIds.length + (coverage as any).uncoveredTargetIds.length
      : fallbackTotal)
  const totalAssessableTargets = Number.isFinite(rawTotal) && rawTotal >= 0
    ? Math.round(Number(rawTotal))
    : Math.max(0, Math.round(fallbackTotal))

  const rawCovered = (coverage as any)?.coveredTargetCount
    ?? (Array.isArray((coverage as any)?.coveredTargetIds) ? (coverage as any).coveredTargetIds.length : 0)
  const coveredTargetCount = Number.isFinite(rawCovered) && rawCovered >= 0
    ? Math.min(totalAssessableTargets, Math.round(Number(rawCovered)))
    : 0

  const rawUncovered = (coverage as any)?.uncoveredTargetCount
    ?? (Array.isArray((coverage as any)?.uncoveredTargetIds)
      ? (coverage as any).uncoveredTargetIds.length
      : Math.max(0, totalAssessableTargets - coveredTargetCount))
  const uncoveredTargetCount = Number.isFinite(rawUncovered) && rawUncovered >= 0
    ? Math.round(Number(rawUncovered))
    : Math.max(0, totalAssessableTargets - coveredTargetCount)

  const rawPercent = Number((coverage as any)?.estimatedCoveragePercent ?? (coverage as any)?.coveragePercent)
  const estimatedCoveragePercent = Number.isFinite(rawPercent)
    ? Math.round(rawPercent * 100) / 100
    : totalAssessableTargets > 0
      ? Math.round((coveredTargetCount / totalAssessableTargets) * 10_000) / 100
      : 0

  const mode: 'first_pass' | 'practice' = (coverage as any)?.mode === 'practice'
    || (uncoveredTargetCount === 0 && totalAssessableTargets > 0)
    ? 'practice'
    : 'first_pass'

  return {
    totalAssessableTargets,
    coveredTargetCount,
    uncoveredTargetCount,
    estimatedCoveragePercent,
    mode,
  }
}

export interface QuizAtomicSlot {
  slotId: string
  primaryTargetId: string
  type: QuizQuestionType
  phase: 'first_pass' | 'practice'
}

export interface QuizScopePlan {
  version: 1
  scopeFingerprint: string
  universeFingerprint: string
  requestedQuestionCount: number
  coverageMode: 'first_pass' | 'practice'
  slots: QuizAtomicSlot[]
  completionReason: QuizCompletionReason
  uncoveredTargetIds?: string[]
}

export interface QuizCompletionStore {
  list(scopeFingerprint: string): Promise<QuizCompletionResult[]>
  insert(result: QuizCompletionResult): Promise<{ applied: boolean; result: QuizCompletionResult }>
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function normalizeText(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase()
}

function stableAnswerValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableAnswerValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableAnswerValue(item)]))
  return value
}

export function quizUniverseFingerprint(universe: EnjoyerAssessmentUniverse): string {
  return hash({
    sourceSelectionFingerprint: universe.fingerprint,
    targets: universe.targets.map(target => ({
      id: target.id,
      sourceItemId: target.sourceItemId,
      kind: target.kind,
      title: target.title,
      content: target.content,
      materialId: target.materialId,
      pages: target.pages,
      sourceSpans: target.sourceSpans,
    })),
  })
}

export function quizCoverageScopeFingerprint(userId: string, universe: EnjoyerAssessmentUniverse): string {
  return hash({
    userId,
    sourceSelectionFingerprint: universe.fingerprint,
    universeFingerprint: quizUniverseFingerprint(universe),
    materialEnjoyerAcademicVersion: MATERIAL_ENJOYER_ACADEMIC_VERSION,
    coverageContractVersion: QUIZ_COVERAGE_CONTRACT_VERSION,
  })
}

function validCompletion(raw: unknown, scopeFingerprint: string, universeFingerprint: string): raw is QuizCompletionResult {
  if (!raw || typeof raw !== 'object') return false
  const value = raw as QuizCompletionResult
  return value.schemaVersion === 'quiz-completion-1'
    && value.coverageContractVersion === QUIZ_COVERAGE_CONTRACT_VERSION
    && value.scopeFingerprint === scopeFingerprint
    && value.universeFingerprint === universeFingerprint
    && typeof value.artifactIdentity === 'string'
    && typeof value.submissionHash === 'string'
    && Array.isArray(value.evidence)
}

export function deriveQuizProgressiveCoverage(
  universe: EnjoyerAssessmentUniverse,
  userId: string,
  completions: readonly QuizCompletionResult[],
): QuizProgressiveCoverage {
  const universeFingerprint = quizUniverseFingerprint(universe)
  const scopeFingerprint = quizCoverageScopeFingerprint(userId, universe)
  const known = new Set(universe.targets.map(target => target.id))
  const evidenceByTarget = new Map<string, Array<QuizTargetEvidence & { completedAt: string }>>()
  const seenArtifacts = new Set<string>()
  for (const completion of completions) {
    if (!validCompletion(completion, scopeFingerprint, universeFingerprint) || seenArtifacts.has(completion.artifactIdentity)) continue
    seenArtifacts.add(completion.artifactIdentity)
    const seenQuestions = new Set<string>()
    for (const evidence of completion.evidence) {
      if (!evidence?.answered || !known.has(evidence.targetId) || !evidence.questionId || seenQuestions.has(evidence.questionId)) continue
      seenQuestions.add(evidence.questionId)
      const values = evidenceByTarget.get(evidence.targetId) || []
      values.push({ ...evidence, completedAt: completion.completedAt })
      evidenceByTarget.set(evidence.targetId, values)
    }
  }
  const targets: Record<string, QuizTargetProgress> = {}
  for (const target of universe.targets) {
    const evidence = (evidenceByTarget.get(target.id) || []).sort((a, b) =>
      Date.parse(a.completedAt) - Date.parse(b.completedAt) || a.questionId.localeCompare(b.questionId))
    const recentResolved = evidence.filter(item => item.score !== null).slice(-3)
    const recentScore = recentResolved.length
      ? Math.round(recentResolved.reduce((sum, item) => sum + Number(item.score), 0) / recentResolved.length)
      : null
    const latest = evidence[evidence.length - 1]
    targets[target.id] = {
      targetId: target.id,
      attempts: evidence.length,
      covered: evidence.length > 0,
      recentScore,
      latestOutcome: latest?.outcome || null,
      lastAssessedAt: latest?.completedAt || null,
      recentTypes: evidence.slice(-4).map(item => item.questionType),
    }
  }
  const coveredTargetIds = universe.targets.map(target => target.id).filter(id => targets[id].covered)
  const uncoveredTargetIds = universe.targets.map(target => target.id).filter(id => !targets[id].covered)
  return {
    scopeFingerprint,
    universeFingerprint,
    totalTargets: universe.targets.length,
    coveredTargetIds,
    uncoveredTargetIds,
    coveredTargetCount: coveredTargetIds.length,
    coveragePercent: universe.targets.length
      ? Math.round(coveredTargetIds.length / universe.targets.length * 10_000) / 100
      : 0,
    mode: uncoveredTargetIds.length ? 'first_pass' : 'practice',
    targets,
  }
}

function typeAliases(target: EnjoyerAssessmentTarget): Set<string> {
  return new Set(target.examTypes.map(value => normalizeText(value).replace(/[\s-]+/g, '_')))
}

export function targetSupportsQuizType(target: EnjoyerAssessmentTarget, type: QuizQuestionType): boolean {
  const kind = normalizeText(target.kind)
  const hints = typeAliases(target)
  if (type === 'multiple_choice' || type === 'short_answer' || type === 'true_false') return true
  if (type === 'fill_blank') return ['fact', 'definition', 'formula', 'entity', 'example'].includes(kind)
    || hints.has('fill_blank') || hints.has('completar')
  if (type === 'matching') return hints.has('matching') || hints.has('relacionar') || hints.has('match')
  // multi_select remains one official assessment target. The authoring layer
  // must produce 2+ distinct correct options grounded in that same
  // authoritative target; strict validation rejects targets that cannot
  // support a defensible multi-answer surface.
  if (type === 'multi_select') return true
  return false
}

function orderedFirstPassTargets(universe: EnjoyerAssessmentUniverse, ids: Set<string>): EnjoyerAssessmentTarget[] {
  const topicOrder = new Map(universe.topics.map(topic => [topic.id, topic.order]))
  const buckets = new Map<string, EnjoyerAssessmentTarget[]>()
  for (const target of universe.targets.filter(candidate => ids.has(candidate.id))) {
    const key = target.topicId || '__unassigned__'
    const bucket = buckets.get(key) || []
    bucket.push(target)
    buckets.set(key, bucket)
  }
  for (const bucket of buckets.values()) bucket.sort((a, b) =>
    b.importance - a.importance || a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id))
  const keys = [...buckets.keys()].sort((a, b) =>
    (topicOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (topicOrder.get(b) ?? Number.MAX_SAFE_INTEGER)
      || a.localeCompare(b))
  const ordered: EnjoyerAssessmentTarget[] = []
  while (keys.some(key => (buckets.get(key)?.length || 0) > 0)) {
    for (const key of keys) {
      const next = buckets.get(key)?.shift()
      if (next) ordered.push(next)
    }
  }
  return ordered
}

function outcomeRank(value: QuizEvidenceOutcome | null): number {
  return value === 'incorrect' ? 0 : value === 'partial' ? 1 : value === 'unresolved' ? 2 : value === 'correct' ? 3 : 2
}

function practiceTargets(universe: EnjoyerAssessmentUniverse, coverage: QuizProgressiveCoverage): EnjoyerAssessmentTarget[] {
  return [...universe.targets].sort((a, b) => {
    const left = coverage.targets[a.id]
    const right = coverage.targets[b.id]
    return outcomeRank(left?.latestOutcome || null) - outcomeRank(right?.latestOutcome || null)
      || (left?.recentScore ?? 101) - (right?.recentScore ?? 101)
      || b.importance - a.importance
      || Date.parse(left?.lastAssessedAt || '1970-01-01') - Date.parse(right?.lastAssessedAt || '1970-01-01')
      || a.id.localeCompare(b.id)
  })
}

export function composeProgressiveQuizScope(params: {
  universe: EnjoyerAssessmentUniverse
  coverage: QuizProgressiveCoverage
  config: QuizConfig
  generationId: string
}): QuizScopePlan {
  const { universe, coverage, config, generationId } = params
  const allowedTypes = [...config.questionTypes]
  const typeUse = new Map<QuizQuestionType, number>(allowedTypes.map(type => [type, 0]))
  const targetTypeUse = new Map<string, number>()
  const slots: QuizAtomicSlot[] = []

  const addSlot = (target: EnjoyerAssessmentTarget, type: QuizQuestionType, phase: QuizAtomicSlot['phase']): boolean => {
    if (slots.length >= config.questionCount) return false
    const pair = `${target.id}:${type}`
    targetTypeUse.set(pair, (targetTypeUse.get(pair) || 0) + 1)
    typeUse.set(type, (typeUse.get(type) || 0) + 1)
    slots.push({
      slotId: `enjoyer-slot:${hash({ generationId, index: slots.length, targetId: target.id, type }).slice(0, 20)}`,
      primaryTargetId: target.id,
      type,
      phase,
    })
    return true
  }

  // FIRST PASS: Uncovered targets prioritized
  const uncovered = orderedFirstPassTargets(universe, new Set(coverage.uncoveredTargetIds))
  for (const target of uncovered) {
    const feasible = allowedTypes.filter(type => targetSupportsQuizType(target, type))
    if (!feasible.length) continue
    feasible.sort((a, b) => (typeUse.get(a) || 0) - (typeUse.get(b) || 0) || a.localeCompare(b))
    addSlot(target, feasible[0], 'first_pass')
    if (slots.length >= config.questionCount) break
  }

  // PRACTICE PASS 1: Fresh (target, type) pairs not yet used, avoiding recent types for that target
  const candidates = practiceTargets(universe, coverage)
    .filter(target => allowedTypes.some(type => targetSupportsQuizType(target, type)))

  while (slots.length < config.questionCount && candidates.length > 0) {
    let added = false
    for (const target of candidates) {
      const feasible = allowedTypes.filter(type => targetSupportsQuizType(target, type))
      const unused = feasible.filter(type => !targetTypeUse.has(`${target.id}:${type}`))
      if (unused.length > 0) {
        const recentTypes = new Set(coverage.targets[target.id]?.recentTypes || [])
        unused.sort((a, b) =>
          (recentTypes.has(a) ? 1 : 0) - (recentTypes.has(b) ? 1 : 0)
          || (typeUse.get(a) || 0) - (typeUse.get(b) || 0)
          || a.localeCompare(b))
        addSlot(target, unused[0], 'practice')
        added = true
        if (slots.length >= config.questionCount) break
      }
    }
    if (!added) break
  }

  // PRACTICE PASS 2 (Small Material Semantics):
  // If slots.length < config.questionCount (e.g. 15 targets, request 100):
  // Repeat practice variants cycling through candidates until exact requested count is reached.
  while (slots.length < config.questionCount && candidates.length > 0) {
    for (const target of candidates) {
      const feasible = allowedTypes.filter(type => targetSupportsQuizType(target, type))
      if (!feasible.length) continue
      feasible.sort((a, b) =>
        (targetTypeUse.get(`${target.id}:${a}`) || 0) - (targetTypeUse.get(`${target.id}:${b}`) || 0)
        || (typeUse.get(a) || 0) - (typeUse.get(b) || 0)
        || a.localeCompare(b))
      addSlot(target, feasible[0], 'practice')
      if (slots.length >= config.questionCount) break
    }
  }

  return {
    version: 1,
    scopeFingerprint: coverage.scopeFingerprint,
    universeFingerprint: coverage.universeFingerprint,
    requestedQuestionCount: config.questionCount,
    coverageMode: coverage.mode,
    slots,
    completionReason: slots.length === config.questionCount ? 'requested_limit_reached' : 'scope_exhausted',
    uncoveredTargetIds: [...coverage.uncoveredTargetIds],
  }
}

export function createReplacementSlot(params: {
  universe: EnjoyerAssessmentUniverse
  config: QuizConfig
  scopePlan: QuizScopePlan
  retiredSlotIds: Set<string>
  currentQuestions?: EnjoyerGroundedQuizQuestion[]
  generationId: string
  avoidTypes?: Set<QuizQuestionType>
}): QuizAtomicSlot | null {
  const { universe, config, scopePlan, retiredSlotIds, currentQuestions = [], generationId } = params
  const avoidTypes = params.avoidTypes || new Set<QuizQuestionType>()
  const allowedTypes = [...config.questionTypes]
  if (!allowedTypes.length || !universe.targets.length) return null

  const activeSlots = scopePlan.slots.filter(slot => !retiredSlotIds.has(slot.slotId))
  const liveTargetIds = new Set<string>([
    ...(currentQuestions || []).map(q => q.grounding?.assessmentTargetIds?.[0]).filter(Boolean),
    ...activeSlots.map(slot => slot.primaryTargetId),
  ])

  const typeUse = new Map<QuizQuestionType, number>(allowedTypes.map(type => [type, 0]))
  for (const slot of activeSlots) typeUse.set(slot.type, (typeUse.get(slot.type) || 0) + 1)

  const targetUse = new Map<string, number>()
  for (const slot of activeSlots) targetUse.set(slot.primaryTargetId, (targetUse.get(slot.primaryTargetId) || 0) + 1)
  for (const q of currentQuestions) {
    const tid = q.grounding?.assessmentTargetIds?.[0]
    if (tid) targetUse.set(tid, (targetUse.get(tid) || 0) + 1)
  }

  // FIRST PASS:
  // If authoritative uncovered targets still exist:
  // choose another uncovered eligible target that is not already represented by an
  // accepted/current live slot in this Quiz.
  const uncoveredPool = scopePlan.uncoveredTargetIds && scopePlan.uncoveredTargetIds.length > 0
    ? scopePlan.uncoveredTargetIds
    : universe.targets.map(t => t.id)
  const uncoveredIds = uncoveredPool.filter(id => !liveTargetIds.has(id))

  if (uncoveredIds.length > 0) {
    const orderedUncovered = orderedFirstPassTargets(universe, new Set(uncoveredIds))
    for (const target of orderedUncovered) {
      const feasible = allowedTypes.filter(type => targetSupportsQuizType(target, type))
      if (!feasible.length) continue
      const preferred = feasible.filter(type => !avoidTypes.has(type))
      const candidateTypes = preferred.length ? preferred : feasible
      candidateTypes.sort((a, b) => (typeUse.get(a) || 0) - (typeUse.get(b) || 0) || a.localeCompare(b))
      const selectedType = candidateTypes[0]
      return {
        slotId: `enjoyer-slot:${hash({ generationId, index: scopePlan.slots.length, targetId: target.id, type: selectedType }).slice(0, 20)}`,
        primaryTargetId: target.id,
        type: selectedType,
        phase: 'first_pass',
      }
    }
  }

  // PRACTICE:
  // If no uncovered first-pass target remains:
  // reuse an authoritative target for a defensible practice variant.
  const eligibleCandidates = universe.targets.filter(target =>
    allowedTypes.some(type => targetSupportsQuizType(target, type)))
  if (!eligibleCandidates.length) return null

  // Sort candidates:
  // 1. Lowest targetUse in current quiz
  // 2. Highest importance
  // 3. sourceOrder
  // 4. deterministic id
  eligibleCandidates.sort((a, b) =>
    (targetUse.get(a.id) || 0) - (targetUse.get(b.id) || 0)
    || b.importance - a.importance
    || a.sourceOrder - b.sourceOrder
    || a.id.localeCompare(b.id))

  const candidate = eligibleCandidates[0]
  const feasible = allowedTypes.filter(type => targetSupportsQuizType(candidate, type))
  const usedTypesForCandidate = new Set(
    activeSlots.filter(s => s.primaryTargetId === candidate.id).map(s => s.type))
  const unusedTypes = feasible.filter(t => !usedTypesForCandidate.has(t))
  const baseCandidateTypes = unusedTypes.length > 0 ? unusedTypes : feasible
  const preferredCandidateTypes = baseCandidateTypes.filter(type => !avoidTypes.has(type))
  const candidateTypes = preferredCandidateTypes.length ? preferredCandidateTypes : baseCandidateTypes
  candidateTypes.sort((a, b) => (typeUse.get(a) || 0) - (typeUse.get(b) || 0) || a.localeCompare(b))
  const selectedType = candidateTypes[0]

  return {
    slotId: `enjoyer-slot:${hash({ generationId, index: scopePlan.slots.length, targetId: candidate.id, type: selectedType }).slice(0, 20)}`,
    primaryTargetId: candidate.id,
    type: selectedType,
    phase: 'practice',
  }
}

function isAnswered(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return true
}

function scoreQuestion(question: EnjoyerGroundedQuizQuestion, answer: unknown): { score: number | null; outcome: QuizEvidenceOutcome } {
  if (question.type === 'multiple_choice') {
    const score = Number(answer) === question.correctAnswer ? 100 : 0
    return { score, outcome: score === 100 ? 'correct' : 'incorrect' }
  }
  if (question.type === 'true_false') {
    const user = answer === true || answer === 0 || String(answer).toLowerCase() === 'true' || String(answer).toLowerCase() === 'verdadero'
    const score = user === question.correctAnswer ? 100 : 0
    return { score, outcome: score === 100 ? 'correct' : 'incorrect' }
  }
  if (question.type === 'multi_select') {
    const expected = new Set(question.correctAnswers)
    const selected = new Set(Array.isArray(answer) ? answer.map(Number) : [])
    const correct = [...selected].filter(index => expected.has(index)).length
    const wrong = [...selected].filter(index => !expected.has(index)).length
    const score = Math.max(0, Math.round((correct - wrong) / Math.max(expected.size, 1) * 100))
    return { score, outcome: score === 100 ? 'correct' : score > 0 ? 'partial' : 'incorrect' }
  }
  if (question.type === 'matching') {
    const value = answer && typeof answer === 'object' ? answer as Record<string, unknown> : {}
    const correct = question.pairs.filter((_, index) => Number(value[index]) === index).length
    const score = Math.round(correct / Math.max(question.pairs.length, 1) * 100)
    return { score, outcome: score === 100 ? 'correct' : score > 0 ? 'partial' : 'incorrect' }
  }
  const accepted = question.type === 'fill_blank' ? [question.answer] : question.acceptedAnswers
  const normalized = normalizeText(answer)
  const exact = accepted.some(expected => normalizeText(expected) === normalized)
  if (exact) return { score: 100, outcome: 'correct' }
  if (question.type === 'fill_blank' && question.wordBank?.length) return { score: 0, outcome: 'incorrect' }
  return { score: null, outcome: 'unresolved' }
}

export function buildQuizCompletionResult(params: {
  userId: string
  universe: EnjoyerAssessmentUniverse
  artifact: EnjoyerQuizArtifact
  artifactIdentity: string
  answers: Array<{ questionId: string; answer: unknown }>
  completedAt?: string
}): QuizCompletionResult {
  if (params.artifact.meta.status !== 'ready') throw new Error('QUIZ_NOT_READY')
  if (!params.artifact.scopePlan) throw new Error('LEGACY_QUIZ_HAS_NO_PROGRESSIVE_COVERAGE')
  const knownQuestions = new Set(params.artifact.questions.map(question => question.id))
  const answerByQuestion = new Map<string, unknown>()
  for (const item of params.answers) {
    const questionId = String(item?.questionId || '')
    if (!knownQuestions.has(questionId)) throw new Error('UNKNOWN_QUIZ_QUESTION')
    if (answerByQuestion.has(questionId)) throw new Error('DUPLICATE_QUIZ_ANSWER')
    answerByQuestion.set(questionId, item.answer)
  }
  const evidence: QuizTargetEvidence[] = []
  for (const question of params.artifact.questions) {
    const answer = answerByQuestion.get(question.id)
    if (!isAnswered(answer)) continue
    const targetIds = [...new Set(question.grounding.assessmentTargetIds)]
    if (targetIds.length !== 1 || !params.universe.targets.some(target => target.id === targetIds[0])) {
      throw new Error('INVALID_ATOMIC_TARGET_AUTHORITY')
    }
    const graded = scoreQuestion(question, answer)
    evidence.push({
      questionId: question.id,
      targetId: targetIds[0],
      questionType: question.type,
      answered: true,
      score: graded.score,
      outcome: graded.outcome,
    })
  }
  if (!evidence.length) throw new Error('EMPTY_QUIZ_SUBMISSION')
  const universeFingerprint = quizUniverseFingerprint(params.universe)
  const scopeFingerprint = quizCoverageScopeFingerprint(params.userId, params.universe)
  const canonicalAnswers = params.artifact.questions.flatMap(question => {
    const answer = answerByQuestion.get(question.id)
    return isAnswered(answer) ? [{ questionId: question.id, answer: stableAnswerValue(answer) }] : []
  })
  const submissionHash = hash({ artifactIdentity: params.artifactIdentity, answers: canonicalAnswers })
  return {
    schemaVersion: 'quiz-completion-1',
    coverageContractVersion: QUIZ_COVERAGE_CONTRACT_VERSION,
    scopeFingerprint,
    sourceSelectionFingerprint: params.universe.fingerprint,
    universeFingerprint,
    artifactIdentity: params.artifactIdentity,
    generationId: params.artifact.meta.generationId,
    submissionHash,
    completedAt: params.completedAt || new Date().toISOString(),
    evidence,
  }
}

export class WorkerQuizCompletionStore implements QuizCompletionStore {
  async list(scopeFingerprint: string): Promise<QuizCompletionResult[]> {
    const rows = await getMaterialResults(`quiz_progress:${scopeFingerprint}`, 'mixto', 'quiz_result')
    return rows.map((row: MaterialResult) => row.payload).filter((value): value is QuizCompletionResult =>
      Boolean(value && typeof value === 'object'))
  }

  async insert(result: QuizCompletionResult): Promise<{ applied: boolean; result: QuizCompletionResult }> {
    return insertImmutableQuizResult({
      id: `quiz_result:${hash({ scopeFingerprint: result.scopeFingerprint, artifactIdentity: result.artifactIdentity })}`,
      material_id: `quiz_progress:${result.scopeFingerprint}`,
      payload: result,
      content_hash: result.submissionHash,
    })
  }
}
