import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'
import { resolveMaterialLanguage } from '../materialLanguage'

export const EXAM_ENJOYER_AUTHORITY_TYPE = 'studyal_material_enjoyer' as const
export const EXAM_ENJOYER_AUTHORITY_VERSION = 'studyal-material-enjoyer-exam-1.0.0'
export const EXAM_ENJOYER_GENERATOR_VERSION = 'enjoyer-exam-evidence-4.0.0'

export type ExamQuestionType = 'multiple_choice' | 'true_false' | 'fill_blank' | 'short_answer' | 'multi_select' | 'matching'
export function examQuestionPoints(type: string): number {
  return type === 'matching' || type === 'multi_select' ? 15 : type === 'short_answer' ? 12 : 10
}
export type ExamDifficulty = 'basic' | 'medium' | 'advanced'
export type ExamCognitiveLevel = 'recall' | 'discrimination' | 'integration'
// EXAM_PRODUCT_CORRECTION: an axis independent of response type — a
// multiple_choice question is not automatically "comprehension", and a
// short_answer is not automatically "explanation". Derived from the
// Enjoyer's own bloomLevel when present (never from `type`).
export type ExamSkill = 'retention' | 'comprehension' | 'application' | 'critical_thinking' | 'relation' | 'explanation'

export interface ExamEnjoyerSourceSpan { page: number; quote: string; certainty?: 'supported' | 'inferred' | 'uncertain' }

export interface ExamSourceAffordances {
  canRecall: boolean
  canExplain: boolean
  canInterpret: boolean
  canApplyConcreteCase: boolean
}

export interface ExamEnjoyerTarget {
  id: string
  sourceItemId: string
  kind: string
  label: string
  content: string
  importance: number
  difficulty: string
  examTypes: ExamQuestionType[]
  /** Raw, normalized hint strings as the Enjoyer wrote them (e.g. "open",
   * "problem", "mcq") — kept SEPARATE from `examTypes` (the mapped
   * response-type candidates) so skill inference never collapses to
   * response type: an "open"/"problem" hint signals application/analysis
   * demand even when the composer ultimately renders it as a
   * multiple_choice question for time-budget reasons. */
  rawExamTypeHints: string[]
  bloomLevel: string | null
  topicId: string | null
  topicTitle: string | null
  sourceOrder: number
  materialId: string
  pages: number[]
  sourceSpans: ExamEnjoyerSourceSpan[]
  sourceAffordances?: ExamSourceAffordances
  misconceptions?: string[]
}

export interface ExamEnjoyerRelation {
  id: string
  type: string
  fromSourceItemId: string
  toSourceItemId: string
}

/**
 * EXAM_FINAL blocker #9: every raw Enjoyer item that does NOT become an
 * ExamEnjoyerTarget is recorded here with an explicit reason — never
 * silently dropped before any denominator exists. `missing_provider_output`
 * is deliberately NOT a valid reason value: an item failing validation
 * here is a malformed-authority problem, never reclassified as "the
 * provider didn't produce this," which would misattribute an academic-
 * authority defect as a generation gap.
 */
export interface ExamEnjoyerRejectedItem {
  sourceItemId: string
  reason: 'missing_required_fields' | 'duplicate_id' | 'duplicate_exact_content' | 'non_academic_kind'
}

export interface ExamEnjoyerUniverse {
  authorityType: typeof EXAM_ENJOYER_AUTHORITY_TYPE
  authorityVersion: string
  fingerprint: string
  targets: ExamEnjoyerTarget[]
  topics: Array<{ id: string; title: string; order: number }>
  relations: ExamEnjoyerRelation[]
  /** EXAM_FINAL blocker #9 — see ExamEnjoyerRejectedItem. */
  rejectedItems: ExamEnjoyerRejectedItem[]
  /**
   * EXAM_FINAL blocker #6: the persisted Enjoyer authority carries no
   * materialLanguage field end-to-end (an upstream blueprint-producer
   * gap outside Exam's scope — never touched here). Detected locally
   * from the Enjoyer's OWN target text (never PDF reanalysis, never a
   * provider call, never the browser/UI locale) so exam authoring and
   * grading can stay in the material's real language instead of
   * defaulting to Spanish regardless of source language.
   */
  materialLanguage: string
}

export type ExamAnswerAuthority =
  | { kind: 'single_text'; canonicalValue: string; distractorPool: string[]; answerUnit?: { semanticClass: FillBlankUnit['semanticClass']; sourceItemId: string; sourceSpans: ExamEnjoyerSourceSpan[]; content: string; kind: string } }
  | { kind: 'boolean'; value: boolean; canonicalStatement: string }
  | { kind: 'multi_text'; canonicalValues: string[]; distractorPool: string[] }
  | { kind: 'pairs'; pairs: { left: string; right: string }[] }

export interface ExamFrozenSourceItem {
  kind?: string
  topicId?: string | null
  topicTitle?: string | null
  misconceptions?: string[]
  bloomLevel?: string | null
  examTypeHints?: string[]
  sourceItemId: string
  label: string
  content: string
  materialId: string
  pages: number[]
  sourceSpans: ExamEnjoyerSourceSpan[]
}

export interface ExamAssessmentCriterion {
  criterionId: string
  targetIds: string[]
  operation: 'retrieve' | 'interpret' | 'use' | 'compare' | 'explain' | 'diagnose'
  canonicalCriterion: string
  gradingMode: 'deterministic' | 'semantic'
  points: number
  skill: ExamSkill
  label: string
  sourceItemId: string
  pages: number[]
  materialId: string
  /** Private correspondence for a component of a closed instrument. */
  componentIndex?: number
}

export interface ExamComposedSlot {
  /** Optional so historical frozen slots retain their original authoring contract. */
  authoringContractVersion?: 2
  evidenceRelations?: ExamEnjoyerRelation[]
  assessmentCriteria?: ExamAssessmentCriterion[]
  id: string
  /** EXAM_PRODUCT_CORRECTION: the ONE target this slot's scored decision
   * actually discriminates. Only this target receives independent
   * assessment evidence from the resulting response. */
  primaryTargetId: string
  /** Targets that support/frame the question (same-topic neighbors) but
   * are NEVER independently scored by a single binary/scalar response —
   * for multiple_choice/true_false/fill_blank/short_answer this is
   * capped small (<=2) and purely presentational context. For
   * matching/multi_select, where each grouped target genuinely produces
   * its OWN independent gradable decision (a pair, an include/exclude
   * choice), ALL group targets are treated as assessed and this array is
   * empty — see `assessedTargetIds` below for the authoritative list. */
  contextTargetIds: string[]
  /** All targets this slot's frozen sources/grounding actually touch —
   * primary + context (or, for matching/multi_select, every grouped
   * target). Kept for backward-compatible grounding/rendering code that
   * iterates the full set. */
  targetIds: string[]
  /** Targets that receive independent scored evidence from this slot —
   * primary-only for single-answer types, all grouped targets for
   * matching/multi_select. */
  assessedTargetIds: string[]
  sourceItemIds: string[]
  type: ExamQuestionType
  cognitiveLevel: ExamCognitiveLevel
  cognitiveOperation?: 'retrieve' | 'interpret' | 'use' | 'compare' | 'explain' | 'diagnose'
  skill: ExamSkill
  /** Short, human-readable diagnostic focus — what this ONE scored
   * decision is meant to reveal about the student. Derived from the
   * primary target's own label, never invented. */
  assessmentFocus: string
  difficulty: ExamDifficulty
  estimatedSeconds: number
  /** EXAM_PRODUCT_CORRECTION: bounded reading-load estimate (whitespace
   * tokens) for this slot's frozen source text — used by the whole-exam
   * burden budget, never by the model. */
  readingBudgetWords: number
  answerAuthority: ExamAnswerAuthority
  frozenSources: ExamFrozenSourceItem[]
  topicId: string | null
  topicTitle: string | null
  order: number
  replacesSlotId?: string
  supersededBySlotId?: string
  sourceAffordances?: ExamSourceAffordances
  setPredicate?: string
}

export interface ExamCoverageMetadata {
  consideredTargetIds?: string[]
  criterionTargetIds?: string[]
  sufficientEvidenceTargetIds?: string[]
  /** Every target in the academic universe — the accounting denominator. */
  totalUniverseTargets: number
  /** Targets that received an independent scored evidence opportunity
   * (a slot's primary target, or any target inside a matching/
   * multi_select group). */
  assessedTargetIds: string[]
  /** Targets that appeared only as supporting context in some slot —
   * never independently scored. */
  contextOnlyTargetIds: string[]
  /** Targets present in the academic universe that this exam's chosen
   * scope did not touch at all — an honest, visible omission, never
   * disguised as "non-assessable" or silently dropped. */
  notAssessedDueToScopeTargetIds: string[]
  assessedCoveragePercent: number
  coverageStatus: 'complete' | 'scoped_sample'
  topicCoverage: Array<{ topicId: string; topicTitle: string; assessed: number; total: number }>
  // Legacy field names kept for backward-compatible callers/tests that
  // read the OLD "every target ID appears somewhere" accounting — never
  // presented in the UI as "100% assessed" anymore (see route.ts).
  totalAssessableTargets: number
  representedTargetIds: string[]
  uncoveredTargetIds: string[]
  totalEvaluableTargets: number
  coveredTargets: number
  coveredSourceItemIds: string[]
  uncoveredSourceItemIds: string[]
  coveragePercent: number
}

export interface ExamBlueprint {
  targetUniverse?: Array<{ targetId: string; label: string; pages: number[]; materialId: string; canonicalRequirement: string }>
  schemaVersion: number
  authorityType: typeof EXAM_ENJOYER_AUTHORITY_TYPE
  authorityVersion: string
  generatorVersion: string
  examId: string
  fingerprint: string
  requestedDurationMinutes: number
  durationMinutes: number
  effectiveDurationMinutes: number
  idealDurationMinutes: number
  minimumViableDurationMinutes: number
  seed: string
  /** EXAM_FINAL blocker #6 — see ExamEnjoyerUniverse.materialLanguage. */
  materialLanguage: string
  slots: ExamComposedSlot[]
  totalExamTargets: number
  representedTargetIds: string[]
  typeDistribution: Record<ExamQuestionType, number>
  difficultyDistribution: Record<ExamDifficulty, number>
  skillDistribution: Record<ExamSkill, number>
  expectedCompletionSeconds: number
  totalReadingBudgetWords: number
  coveragePercent: number
  coverage: ExamCoverageMetadata
}

type EnjoyerAuthority = {
  sourceSelectionFingerprint?: unknown
  materialIds?: unknown
  selectedPages?: unknown
  sourceSelection?: { materialIds?: unknown; selectedPages?: unknown }
  topicsIndex?: unknown
  globalOrderedAnalysis?: unknown
  uniqueConceptsIndex?: unknown
  relations?: unknown
  materialLanguage?: unknown
}

const EXAM_TYPES: ExamQuestionType[] = [
  'multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer',
]

const TYPE_SECONDS: Record<ExamQuestionType, number> = {
  true_false: 35,
  multiple_choice: 55,
  fill_blank: 45,
  short_answer: 90,
  multi_select: 75,
  matching: 90,
}

// EXAM_PRODUCT_CORRECTION: a slot with 0-2 context targets is a small,
// FIXED cap — never grown to fit duration. Duration controls how many
// slots (assessment SCOPE) are included, never how many targets one
// slot compresses together.
const MAX_CONTEXT_TARGETS = 2

function authorityFrom(payload: unknown): EnjoyerAuthority {
  const wrapper = payload as { blueprint?: EnjoyerAuthority } | null
  return (wrapper?.blueprint || payload || {}) as EnjoyerAuthority
}

function normalize(value: unknown): string {
  return String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * EXAM_FINAL blocker #7: `normalize()` above strips ALL punctuation —
 * including mathematical/chemical operators (+, -, =, etc.) — which is
 * correct for kind/alias/difficulty matching but was WRONG when reused
 * to compute the exact-duplicate-content dedup key: "ΔG = a+b" and
 * "ΔG = a-b" both normalized to "g a b" and collapsed into one target,
 * silently losing a distinct formula. This identity-only normalization
 * preserves NFC (no diacritic decomposition that could alter symbols),
 * case-folds, and collapses whitespace — but never touches punctuation
 * or operators, so mathematically distinct content stays distinct.
 */
function normalizeForIdentity(value: unknown): string {
  return String(value || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(String).map(item => item.trim()).filter(Boolean))] : []
}

function pages(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value.map(Number).filter(page => Number.isInteger(page) && page > 0))].sort((a, b) => a - b)
    : []
}

function spans(value: unknown): ExamEnjoyerSourceSpan[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap(raw => {
    const source = raw as Record<string, unknown>
    const page = Number(source.page)
    const quote = String(source.quote || source.text || '').trim()
    const key = `${page}:${quote}`
    if (!Number.isInteger(page) || page < 1 || !quote || seen.has(key)) return []
    seen.add(key)
    return [{ page, quote, ...(['supported', 'inferred', 'uncertain'].includes(String(source.certainty))
      ? { certainty: source.certainty as ExamEnjoyerSourceSpan['certainty'] } : {}) }]
  })
}

// EXAM_PRODUCT_CORRECTION: `open` and `problem` are REAL Enjoyer hints
// that previously vanished here (unrecognized -> silently dropped),
// starving the composer of the exact signals that indicate
// application/analysis-worthy content. Mapped to their closest response
// format (short_answer) for TYPE selection — the original raw strings
// are preserved separately (rawExamTypeHints) for SKILL inference, so
// "open"/"problem" content is never reduced to "this must be a
// short_answer question" either.
export const EXAM_TYPE_ALIASES: Record<string, ExamQuestionType> = {
  mcq: 'multiple_choice', multiple_choice: 'multiple_choice', multiplechoice: 'multiple_choice',
  multi_select: 'multi_select', multiple_answers: 'multi_select', multiple_answer: 'multi_select',
  true_false: 'true_false', truefalse: 'true_false', boolean: 'true_false',
  fill_blank: 'fill_blank', fill_in_blank: 'fill_blank', completion: 'fill_blank',
  matching: 'matching', match: 'matching', short_answer: 'short_answer', shortanswer: 'short_answer',
  open: 'short_answer', open_response: 'short_answer', problem: 'short_answer',
  desarrollo: 'short_answer', pregunta_de_desarrollo: 'short_answer', abierta: 'short_answer',
  pregunta_abierta: 'short_answer', calculo: 'short_answer', calculation: 'short_answer',
  free_response: 'short_answer', respuesta_corta: 'short_answer',
}

function normalizedExamTypes(value: unknown): ExamQuestionType[] {
  return [...new Set(strings(value).flatMap(raw => {
    const key = normalize(raw).replace(/\s+/g, '_')
    return EXAM_TYPE_ALIASES[key] ? [EXAM_TYPE_ALIASES[key]] : []
  }))]
}

function rawExamTypeHints(value: unknown): string[] {
  return [...new Set(strings(value).map(raw => normalize(raw).replace(/\s+/g, '_')).filter(Boolean))]
}

function importance(value: unknown): number {
  if (Number.isFinite(Number(value))) return Math.max(0, Math.min(100, Number(value)))
  const key = normalize(value)
  if (key === 'critical' || key === 'high') return 90
  if (key === 'supporting' || key === 'medium') return 60
  return 35
}

const BLOOM_ALIASES: Record<string, string> = {
  remember: 'remember', recall: 'remember', recordar: 'remember', memorizar: 'remember',
  understand: 'understand', comprehend: 'understand', comprender: 'understand', entender: 'understand',
  apply: 'apply', application: 'apply', aplicar: 'apply',
  analyze: 'analyze', analysis: 'analyze', analizar: 'analyze',
  evaluate: 'evaluate', evaluation: 'evaluate', evaluar: 'evaluate',
  create: 'create', creation: 'create', crear: 'create', synthesize: 'create',
}

function bloomLevel(value: unknown): string | null {
  const key = normalize(value).replace(/\s+/g, '_')
  return BLOOM_ALIASES[key] || null
}

export function hasWorkedMathChain(text: string): boolean {
  const parts = text.split('=')
  if (parts.length < 3) return false
  for (let i = 1; i < parts.length - 1; i++) {
    const middle = parts[i].trim()
    const right = parts[i + 1].trim()
    if (middle.length > 0 && middle.length <= 40 && !/[,;]/.test(middle) && !/[.!?](?:\s|$)/.test(middle) && !/\b[a-zA-Z]{4,}\b/.test(middle)) {
      if (/^[-+]?\d+(?:\.\d+)?(?:\s*[a-zA-Z%°/]+)?(?:\s|$|[.,;])/.test(right)) {
        return true
      }
    }
  }
  return false
}

export function hasVerifiedOperandsOrWorkedCase(target: Pick<ExamEnjoyerTarget, 'label' | 'content'>): boolean {
  const content = String(target.content || '').trim()
  const label = String(target.label || '').trim()
  const combined = (label + ' ' + content).trim()
  if (content.length < 25) return false

  if (hasWorkedMathChain(content)) return true
  if (/\brec[ií]proco\s+de\s+[-+]?\d+(?:\.\d+)?/i.test(content)) return true

  const hasWorkedProblemMarker = /\b(?:problema\s+(?:n[uú]mero\s+)?\d+|ejemplo\s+(?:de\s+c[aá]lculo|trabajado|pr[aá]ctico)|problem\s+(?:number\s+)?\d+|worked\s+example)\b/i.test(combined)
  const hasCalculationProcedure = /\b(?:sustituy(?:endo|e|en)|reemplaz(?:ando|a|an)|calcul(?:ando|a|ado|ar)|obten(?:iendo|emos|ido|dr[aá])|resulta(?:do|ndo)?|substitut(?:ing|es)|calculat(?:ing|ed)|yields?|evaluat(?:ing|ed))\b/i.test(content)
  const hasConcreteOutput = /\b(?:se\s+obtiene|obteniendo|da\s+como\s+resultado|resultado\s+(?:es|=))\s+[-+]?\d+(?:\.\d+)?/i.test(content) || /tabla\s+ICE/i.test(content)

  if (hasWorkedProblemMarker && (hasCalculationProcedure || /\d+(?:\.\d+)?/.test(content))) return true
  if (hasCalculationProcedure && hasConcreteOutput) return true

  return false
}

export function classifySourceAffordances(target: Pick<ExamEnjoyerTarget, 'label' | 'content' | 'kind'>): ExamSourceAffordances {
  const content = String(target.content || '').trim()
  const label = String(target.label || '').trim()
  const combined = `${label} ${content}`

  const canRecall = Boolean(label && content)

  const canInterpret = Boolean(
    content.length > 0 &&
    !['decorative', 'divider', 'heading', 'metadata'].includes(target.kind)
  )

  const hasExplanatoryMarkers = /\b(?:por\s*qu[eé]|porque|c[oó]mo|mecanismo|raz[oó]n|debido\s+a|ya\s+que|permite|causa|describe|explica|por\s+lo\s+tanto|en\s+consecuencia|why|how|because|mechanism|reason|due\s+to|explains|describes)\b/i.test(combined)
  const canExplain = Boolean(
    target.kind === 'process' ||
    target.kind === 'relation' ||
    hasExplanatoryMarkers ||
    /[.!?]\s+\S/.test(content)
  )

  const canApplyConcreteCase = hasVerifiedOperandsOrWorkedCase(target)

  return { canRecall, canExplain, canInterpret, canApplyConcreteCase }
}

/** EXAM_PRODUCT_CORRECTION: independent of response type — see ExamSkill. */
export function skillFor(target: ExamEnjoyerTarget): ExamSkill {
  if (target.kind === 'relation') return 'relation'
  if (target.kind === 'process' && target.bloomLevel === 'understand') return 'explanation'
  // A provided datum/definition does not become a worked application
  // just because an upstream Bloom label says apply.
  if (target.bloomLevel === 'apply' && ['fact', 'definition'].includes(target.kind)) return 'retention'
  if (target.bloomLevel === 'apply' && target.kind === 'example' && !/[.!?]\s+\S/.test(target.content)) return 'comprehension'

  if (target.bloomLevel === 'analyze' || target.bloomLevel === 'evaluate' || target.bloomLevel === 'create') return 'critical_thinking'

  // Candidate application: bloomLevel === 'apply' or raw hint 'problem'.
  // Constrained by verified source affordance: application requires documented
  // operands/worked case in primary source text. If missing, downgrade to
  // conservative, answerable operation (explanation if mechanism/process, else comprehension).
  const candidateApplication = target.bloomLevel === 'apply'
    || (target.rawExamTypeHints.includes('problem') && ['example', 'process', 'formula'].includes(target.kind))

  if (candidateApplication) {
    const affordances = target.sourceAffordances || classifySourceAffordances(target)
    if (affordances.canApplyConcreteCase) {
      return 'application'
    }
    // Downgrade to conservative, answerable grounded skill:
    if (affordances.canExplain && (target.kind === 'process' || /\b(?:por\s*qu[eé]|porque|mecanismo|raz[oó]n|debido\s+a|why|how|mechanism)\b/i.test(target.content))) {
      return 'explanation'
    }
    return 'comprehension'
  }

  if (target.bloomLevel === 'remember') return 'retention'
  if (target.bloomLevel === 'understand') return 'comprehension'

  return 'comprehension'
}

function exactStringSet(value: unknown): string[] {
  if (Array.isArray(value)) return strings(value).sort()
  return []
}

function assertSelectionMetadata(authority: EnjoyerAuthority, selection: SourceSelectionSnapshot): void {
  if (String(authority.sourceSelectionFingerprint || '') !== selection.fingerprint) throw new Error('SOURCE_SELECTION_MISMATCH')
  const persistedMaterialIds = exactStringSet(authority.materialIds ?? authority.sourceSelection?.materialIds)
  if (persistedMaterialIds.length && JSON.stringify(persistedMaterialIds) !== JSON.stringify([...selection.materialIds].sort())) {
    throw new Error('SOURCE_SELECTION_MISMATCH')
  }
  const rawSelectedPages = authority.selectedPages ?? authority.sourceSelection?.selectedPages
  if (rawSelectedPages && typeof rawSelectedPages === 'object') {
    const actual = rawSelectedPages as Record<string, unknown>
    for (const materialId of selection.materialIds) {
      if (JSON.stringify(pages(actual[materialId])) !== JSON.stringify(pages(selection.selectedPages[materialId]))) {
        throw new Error('SOURCE_SELECTION_MISMATCH')
      }
    }
  }
}

export function buildExamEnjoyerUniverse(payload: unknown, selection: SourceSelectionSnapshot): ExamEnjoyerUniverse {
  const authority = authorityFrom(payload)
  assertSelectionMetadata(authority, selection)
  const selectedPages = new Map(selection.materials.map(material => [material.materialId, new Set(material.selectedPages)]))
  const topics = (Array.isArray(authority.topicsIndex) ? authority.topicsIndex : []).map((raw, index) => {
    const topic = raw as Record<string, unknown>
    return { id: String(topic.id || `topic_${index}`), title: String(topic.title || topic.name || '').trim(), order: Number(topic.order ?? index) }
  })
  const topicTitles = new Map(topics.map(topic => [topic.id, topic.title]))
  const rawItems = [
    ...(Array.isArray(authority.globalOrderedAnalysis) ? authority.globalOrderedAnalysis : []),
    ...(Array.isArray(authority.uniqueConceptsIndex) ? authority.uniqueConceptsIndex : []),
  ]
  const seenIds = new Set<string>()
  const seenExactContent = new Set<string>()
  const aliases = new Map<string, string>()
  const canonicalByContent = new Map<string, string>()
  const targets: ExamEnjoyerTarget[] = []
  // EXAM_FINAL blocker #9: explicit, inspectable record of every raw
  // item that does NOT become an assessable target — never a silent
  // drop before coverage accounting exists.
  const rejectedItems: ExamEnjoyerRejectedItem[] = []
  const languageSampleParts: string[] = []
  for (const [index, raw] of rawItems.entries()) {
    const item = raw as Record<string, unknown>
    const sourceItemId = String(item.id || '').trim()
    const label = String(item.name || item.label || item.title || '').trim()
    const content = String(item.summary || item.content || item.statement || '').trim()
    const kind = String(item.kind || 'academic_item').trim()
    if (!sourceItemId || !label || !content) {
      if (sourceItemId) rejectedItems.push({ sourceItemId, reason: 'missing_required_fields' })
      continue
    }
    if (seenIds.has(sourceItemId)) { rejectedItems.push({ sourceItemId, reason: 'duplicate_id' }); continue }
    if (['metadata', 'decorative', 'divider', 'heading'].includes(normalize(kind))) {
      rejectedItems.push({ sourceItemId, reason: 'non_academic_kind' })
      continue
    }
    // EXAM_FINAL blocker #7: identity uses normalizeForIdentity (NFC,
    // case-fold, whitespace-collapse only) — NEVER the punctuation/
    // operator-stripping normalize() above — so distinct formulas like
    // "ΔG = a+b" vs "ΔG = a-b" are never merged into one target.
    // Scoped per material: identical wording in two materials is two independent sources.
    const identityMaterialId = String(item.materialId || strings(item.materialIds)[0] || (selection.materialIds.length === 1 ? selection.materialIds[0] : '') || '')
    const exactIdentity = `${identityMaterialId}::${normalizeForIdentity(label)}::${normalizeForIdentity(content)}`
    if (seenExactContent.has(exactIdentity)) { aliases.set(sourceItemId, canonicalByContent.get(exactIdentity)!); rejectedItems.push({ sourceItemId, reason: 'duplicate_exact_content' }); continue }
    if (languageSampleParts.length < 40) languageSampleParts.push(label, content)
    const materialIds = strings(item.materialIds)
    const materialId = identityMaterialId
    const authorized = selectedPages.get(materialId)
    if (!authorized) throw new Error('SOURCE_SELECTION_MISMATCH')

    const itemSpans = spans(item.sourceSpans)
    const rawPages = pages(item.pages).length ? pages(item.pages) : pages(itemSpans.map(span => span.page))
    const authorizedPages = rawPages.filter(page => authorized.has(page))
    const authorizedSpans = itemSpans.filter(span => authorized.has(span.page))

    // If item has ZERO overlap with authorized pages in selection, fail closed
    if (authorizedPages.length === 0 && authorizedSpans.length === 0) {
      throw new Error('SOURCE_SELECTION_MISMATCH')
    }

    const itemPages = authorizedPages.length ? authorizedPages : pages(authorizedSpans.map(span => span.page))
    const topicIds = strings(item.topicIds)
    const topicId = String(item.topicId || topicIds[0] || '') || null
    seenIds.add(sourceItemId)
    seenExactContent.add(exactIdentity)
    canonicalByContent.set(exactIdentity, sourceItemId)
    aliases.set(sourceItemId, sourceItemId)
    const targetCandidate: ExamEnjoyerTarget = {
      id: `exam_target:${sourceItemId}`, sourceItemId, kind, label, content,
      ...(Array.isArray(item.misconceptions) ? { misconceptions: strings(item.misconceptions) } : {}),
      importance: importance(item.importance ?? item.importanceTier), difficulty: String(item.difficulty || 'medium'),
      examTypes: normalizedExamTypes(item.examTypes), rawExamTypeHints: rawExamTypeHints(item.examTypes),
      bloomLevel: bloomLevel(item.bloomLevel),
      topicId, topicTitle: topicId ? topicTitles.get(topicId) || null : null,
      sourceOrder: Number(item.globalOrder ?? item.firstAppearanceOrder ?? index), materialId, pages: itemPages, sourceSpans: authorizedSpans,
    }
    targetCandidate.sourceAffordances = classifySourceAffordances(targetCandidate)
    targets.push(targetCandidate)
  }
  targets.sort((a, b) => a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id))
  if (!targets.length) throw new Error('NO_ASSESSABLE_TARGETS')

  const sourceIds = new Set(targets.map(target => target.sourceItemId))

  // Index accepted raw items by sourceItemId so nested relations ONLY come from authorized owning targets
  const acceptedRawItemBySourceId = new Map<string, Record<string, unknown>>()
  for (const raw of rawItems) {
    const item = raw as Record<string, unknown>
    const id = String(item.id || '').trim()
    if (id && sourceIds.has(id) && !acceptedRawItemBySourceId.has(id)) {
      acceptedRawItemBySourceId.set(id, item)
    }
  }

  const rawRelations: Array<{
    id?: string
    type: string
    from: string
    to: string
  }> = []

  // 1. Top-level authority.relations
  for (const raw of (Array.isArray(authority.relations) ? authority.relations : [])) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>

    // Relation type is preserved, never inferred
    const rawType = typeof r.type === 'string' && r.type.trim() ? r.type.trim() : (typeof r.kind === 'string' && r.kind.trim() ? r.kind.trim() : null)
    if (!rawType) continue

    const explicitSources = [r.fromSourceItemId, r.fromId, r.sourceId, r.from]
      .filter(v => typeof v === 'string' && v.trim())
      .map(v => (v as string).trim().replace(/^exam_target:/, ''))
    const uniqueSources = [...new Set(explicitSources)]

    const explicitTargets = [r.toSourceItemId, r.toId, r.targetId, r.to]
      .filter(v => typeof v === 'string' && v.trim())
      .map(v => (v as string).trim().replace(/^exam_target:/, ''))
    const uniqueTargets = [...new Set(explicitTargets)]

    // Conflicting explicit source or target endpoints fail closed
    if (uniqueSources.length !== 1 || uniqueTargets.length !== 1) continue

    const fromRaw = uniqueSources[0]
    const toRaw = uniqueTargets[0]

    // Aliases from unselected/duplicate blocks cannot authorize endpoints as sources
    if (!sourceIds.has(fromRaw)) continue

    const to = aliases.get(toRaw) || toRaw

    rawRelations.push({
      id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : undefined,
      type: rawType,
      from: fromRaw,
      to,
    })
  }

  // 2. Nested relations on authorized owning blocks ONLY
  // "nested relation source authority is ALWAYS the authorized owning block"
  // "relation payload cannot override/conflict with that owner"
  for (const target of targets) {
    const ownerSourceItemId = target.sourceItemId
    const rawOwner = acceptedRawItemBySourceId.get(ownerSourceItemId)
    if (!rawOwner) continue

    for (const nested of (Array.isArray(rawOwner.relations) ? rawOwner.relations : [])) {
      if (!nested || typeof nested !== 'object') continue
      const r = nested as Record<string, unknown>

      // Relation type is preserved, never inferred
      const rawType = typeof r.type === 'string' && r.type.trim() ? r.type.trim() : (typeof r.kind === 'string' && r.kind.trim() ? r.kind.trim() : null)
      if (!rawType) continue

      const explicitSources = [r.fromSourceItemId, r.fromId, r.sourceId, r.from]
        .filter(v => typeof v === 'string' && v.trim())
        .map(v => (v as string).trim().replace(/^exam_target:/, ''))
      const uniqueSources = [...new Set(explicitSources)]

      // Conflicting explicit source endpoints fail closed
      if (uniqueSources.length > 1) continue

      // Relation payload cannot override/conflict with that owner
      if (uniqueSources.length === 1 && uniqueSources[0] !== ownerSourceItemId) {
        continue
      }

      const explicitTargets = [r.toSourceItemId, r.toId, r.targetId, r.to]
        .filter(v => typeof v === 'string' && v.trim())
        .map(v => (v as string).trim().replace(/^exam_target:/, ''))
      const uniqueTargets = [...new Set(explicitTargets)]

      // Conflicting explicit target endpoints fail closed; targetLabel is NEVER authority
      if (uniqueTargets.length !== 1) continue

      const toRaw = uniqueTargets[0]
      const to = aliases.get(toRaw) || toRaw

      rawRelations.push({
        id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : undefined,
        type: rawType,
        from: ownerSourceItemId,
        to,
      })
    }

    // DependsOn on authorized targets only
    for (const dependency of (Array.isArray(rawOwner.dependsOn) ? rawOwner.dependsOn : [])) {
      const dep = typeof dependency === 'string'
        ? dependency.trim().replace(/^exam_target:/, '')
        : String((dependency as Record<string, unknown>)?.targetId || (dependency as Record<string, unknown>)?.id || '').trim().replace(/^exam_target:/, '')
      if (!dep) continue
      const to = aliases.get(dep) || dep
      rawRelations.push({
        type: 'dependsOn',
        from: ownerSourceItemId,
        to,
      })
    }
  }

  // 3. Final validation and deterministic deduplication
  const relations: ExamEnjoyerRelation[] = []
  const seenRelations = new Set<string>()

  for (const raw of rawRelations) {
    const { from, to, type } = raw

    // Target must resolve to an authorized selected target
    if (!sourceIds.has(from) || !sourceIds.has(to)) continue

    // Self edges fail closed
    if (from === to) continue

    const key = `${from}:${type}:${to}`
    if (seenRelations.has(key)) continue
    seenRelations.add(key)

    relations.push({
      id: raw.id || `relation_${stableHash(key).toString(16)}`,
      type,
      fromSourceItemId: from,
      toSourceItemId: to,
    })
  }
  // EXAM_FINAL blocker #6: prefer an explicit, already-persisted
  // authority.materialLanguage when the Enjoyer payload carries one
  // (a future/alternate producer may set it directly) — otherwise
  // derive it locally from the Enjoyer's OWN accepted target text.
  // Never PDF reanalysis, never a provider call, never the browser/UI
  // locale.
  const materialLanguage = resolveMaterialLanguage(payload)
  return {
    authorityType: EXAM_ENJOYER_AUTHORITY_TYPE, authorityVersion: EXAM_ENJOYER_AUTHORITY_VERSION,
    fingerprint: selection.fingerprint, targets, topics, relations, rejectedItems, materialLanguage,
  }
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 0x01000193) }
  return hash >>> 0
}

function difficultyFor(targets: ExamEnjoyerTarget[]): ExamDifficulty {
  const values = targets.map(target => normalize(target.difficulty))
  if (values.some(value => ['advanced', 'hard', 'difficult', 'avanzado', 'dificil'].includes(value))) return 'advanced'
  if (values.every(value => ['basic', 'easy', 'basico', 'facil'].includes(value))) return 'basic'
  return 'medium'
}

function cognitiveLevel(type: ExamQuestionType): ExamCognitiveLevel {
  if (type === 'fill_blank' || type === 'short_answer') return 'recall'
  if (type === 'matching' || type === 'multi_select') return 'integration'
  return 'discrimination'
}

/** Closed answers must be complete source units. Absence means the
 * composer must use an open response; never cut a canonical criterion. */
export function conciseExcerpt(text: string, maxChars = 180): string {
  const value = String(text || '').trim()
  if (!value || /(?:…|\.\.\.)\s*$/.test(value)) return ''
  // Only a COMPLETE proposition is eligible. Decimal points do not
  // delimit sentences; never cut inside a formula or its delimiters.
  const end = value.search(/[.!?](?:\s|$)/)
  const proposition = end >= 0 ? value.slice(0, end + 1) : value
  if (proposition.length > maxChars) return ''
  if ((proposition.match(/(?<!\\)\$/g) || []).length % 2) return ''
  if ((proposition.match(/\{/g) || []).length !== (proposition.match(/\}/g) || []).length) return ''
  return proposition
}

export function operationForSkill(skill: ExamSkill): NonNullable<ExamComposedSlot['cognitiveOperation']> {
  return ({ retention: 'retrieve', comprehension: 'interpret', application: 'use',
    critical_thinking: 'diagnose', relation: 'compare', explanation: 'explain' } as const)[skill]
}

function wordCount(text: string): number {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length
}

export interface FullAssessmentGroup {
  primary: ExamEnjoyerTarget
  context: ExamEnjoyerTarget[]
  /** For matching/multi_select, every member is independently assessed. */
  allAssessed: boolean
  hintedTypes: ExamQuestionType[]
  topicKey: string
  topicTitle: string
  matchingPairs?: Array<{ left: string; right: string }>
  partnerTargets?: ExamEnjoyerTarget[]
  focalTarget?: ExamEnjoyerTarget
  predicate?: string
}

export const META_LABEL_PREFIX_RE = /^(?:definici[oó]n|concepto|caracter[ií]sticas?|importancia|impacto|explicaci[oó]n|an[aá]lisis|resumen|introducci[oó]n|visi[oó]n|postura|combinaci[oó]n|intereses|legado|avances|origen|desarrollo|descripci[oó]n|funci[oó]n|propiedades|clasificaci[oó]n|tipos|ejemplos?)\s+(?:de(?:l|\s+la|\s+los|\s+las)?|a)\s+/i

export const META_STANDALONE_RE = /^(?:definici[oó]n|concepto|caracter[ií]sticas?|importancia|impacto|explicaci[oó]n|an[aá]lisis|resumen|introducci[oó]n|visi[oó]n|postura|combinaci[oó]n|intereses|legado|avances|origen|desarrollo|descripci[oó]n|funci[oó]n|propiedades|clasificaci[oó]n|tipos|ejemplos?)$/i

export const META_LABEL_RE = META_LABEL_PREFIX_RE

export function isRhetoricalConclusionTarget(target: ExamEnjoyerTarget): boolean {
  if (['formula', 'fact', 'definition'].includes(target.kind)) return false
  if (target.sourceAffordances?.canApplyConcreteCase) return false
  if (hasVerifiedOperandsOrWorkedCase(target)) return false

  const label = (target.label || '').trim()
  const content = (target.content || '').trim()
  const combined = `${label} ${content}`.toLowerCase()

  // Must NOT have dates, years, numbers, or formula notation
  if (/\b(1\d{3}|20\d{2})\b/.test(combined)) return false
  if (/[\d=+*/^_{}\\<>⇌→Δ∑∫²³₀-₉−-]/.test(content)) return false

  // Check for rhetorical conclusion markers
  const hasMetaLabel = META_LABEL_RE.test(label) || /\b(?:legado|arquitecto|grandeza|cualidades|visi[oó]n|figura|revoluci[oó]n|aportes|relevancia)\b/i.test(label)
  const hasRhetoricalContent = /\b(?:en\s+conclusi[oó]n|arquitecto\s+de\s+la\s+ciencia|verdadera\s+grandeza|nueva\s+era\s+cient[ií]fica|f[ií]sicos?\s+m[aá]s\s+influyentes|legado\s+contin[uú]a|legado\s+de|sigue\s+siendo\s+relevante|contin[uú]an?\s+inspirando|transform[oó]\s+la\s+comprensi[oó]n|pensador\s+visionario|cambiaron\s+radicalmente)\b/i.test(content)

  return Boolean(hasMetaLabel && hasRhetoricalContent)
}

export function filterRhetoricalRedundantTargets(targets: ExamEnjoyerTarget[]): {
  retained: ExamEnjoyerTarget[]
  redundantTargetIds: Set<string>
} {
  const byPageTopic = new Map<string, ExamEnjoyerTarget[]>()
  for (const t of targets) {
    const pageKey = `${t.materialId}:${t.pages.join(',')}:${t.topicId}`
    byPageTopic.set(pageKey, [...(byPageTopic.get(pageKey) || []), t])
  }

  const redundantTargetIds = new Set<string>()
  for (const group of byPageTopic.values()) {
    const rhetorical = group.filter(isRhetoricalConclusionTarget)
    if (rhetorical.length > 1) {
      const sorted = [...rhetorical].sort((a, b) => b.importance - a.importance || a.sourceOrder - b.sourceOrder)
      for (let i = 1; i < sorted.length; i++) {
        redundantTargetIds.add(sorted[i].id)
      }
    }
  }

  const retained = targets.filter(t => !redundantTargetIds.has(t.id))
  return { retained, redundantTargetIds }
}

export function requiresCompositeOpenEvidence(
  primary: ExamEnjoyerTarget,
  partner: ExamEnjoyerTarget,
  edgeType: string,
): boolean {
  const normEdge = (edgeType || '').toLowerCase().trim()
  if (['explains', 'derives', 'causes', 'mechanism', 'compares', 'justifies', 'derivation'].includes(normEdge)) {
    return true
  }
  const primaryExplains = skillFor(primary) === 'explanation' || primary.kind === 'process' || classifySourceAffordances(primary).canExplain
  const partnerExplains = partner.kind === 'process' || classifySourceAffordances(partner).canExplain
  if (primaryExplains && partnerExplains && (normEdge === 'dependson' || normEdge === 'related')) {
    return true
  }
  return false
}

export const EXPLICIT_SET_RELATION_TYPES = new Set([
  'characteristic', 'component', 'member', 'consequence', 'pillar', 'stage',
  'phase', 'property', 'principle', 'element', 'postulate', 'type_of', 'example',
  'cause', 'effect', 'part_of',
])

export function isExplicitSetRelation(
  edge: ExamEnjoyerRelation,
  dep: ExamEnjoyerTarget,
  focal: ExamEnjoyerTarget,
): boolean {
  const edgeType = (edge.type || '').trim().toLowerCase()
  return EXPLICIT_SET_RELATION_TYPES.has(edgeType)
}

export const EXPLICIT_MATCHING_RELATION_TYPES = new Set([
  'contribution', 'contributed', 'discovered', 'developed', 'created',
  'definition', 'defines', 'defined_by',
  'function', 'serves_function', 'acts_as',
  'characteristic', 'characterizes', 'property',
  'description', 'described_by',
  'pairs_with', 'matching', 'one_to_one', 'adaptation',
])

export function isExplicitMatchingAssociation(
  edge: ExamEnjoyerRelation,
  fromTarget: ExamEnjoyerTarget,
  toTarget: ExamEnjoyerTarget,
): boolean {
  const edgeType = (edge.type || '').trim().toLowerCase()
  return EXPLICIT_MATCHING_RELATION_TYPES.has(edgeType)
}

export function multiSelectDistractorsFor(
  exclude: ExamEnjoyerTarget[],
  universe: ExamEnjoyerUniverse,
  focal: ExamEnjoyerTarget,
  predicate?: string,
): string[] {
  const excludeIds = new Set(exclude.map(t => t.id))
  const connectedIds = new Set<string>()
  for (const edge of universe.relations) {
    if (edge.fromSourceItemId === focal.sourceItemId || edge.toSourceItemId === focal.sourceItemId) {
      const p = universe.targets.find(t => t.sourceItemId === edge.fromSourceItemId)
      const q = universe.targets.find(t => t.sourceItemId === edge.toSourceItemId)
      if (p) connectedIds.add(p.id)
      if (q) connectedIds.add(q.id)
    }
    if (predicate && (edge.type || '').trim().toLowerCase() === predicate) {
      if (edge.toSourceItemId === focal.sourceItemId) {
        const p = universe.targets.find(t => t.sourceItemId === edge.fromSourceItemId)
        if (p) connectedIds.add(p.id)
      }
    }
  }

  const normFocalLabel = focal.label.trim().toLowerCase()
  const poolDiffTopic: string[] = []
  const poolSameTopic: string[] = []

  for (const target of universe.targets) {
    if (excludeIds.has(target.id) || target.id === focal.id) continue
    if (connectedIds.has(target.id)) continue

    const targetContentNorm = target.content.toLowerCase()
    const targetLabelNorm = target.label.toLowerCase()
    if (normFocalLabel.length >= 4 && (targetContentNorm.includes(normFocalLabel) || targetLabelNorm.includes(normFocalLabel))) {
      continue
    }

    const excerpt = conciseExcerpt(target.content, 180)
    if (excerpt.length >= 10 && excerpt.length <= 180) {
      if (target.topicId !== focal.topicId) {
        if (!poolDiffTopic.includes(excerpt)) poolDiffTopic.push(excerpt)
      } else {
        if (!poolSameTopic.includes(excerpt)) poolSameTopic.push(excerpt)
      }
    }
  }

  const combined = [...poolDiffTopic, ...poolSameTopic]
  return combined.slice(0, 6)
}

/**
 * Builds candidate groups ensuring 100% of the assessable Enjoyer universe is
 * partitioned into legitimate assessment questions.
 *
 * Matching: formed when >=3 explicit compatible pairs exist structurally.
 * Multi-select: formed when >=2 targets share a focal proposition/parent target.
 * Relation pairs: only form composite short-answer when genuinely required.
 * Rhetorical duplicates: omitted from slots and honestly recorded in notAssessedDueToScope.
 */
export function buildCandidateGroups(universe: ExamEnjoyerUniverse, compact = true): FullAssessmentGroup[] {
  const groups: FullAssessmentGroup[] = []
  const integrated = new Set<string>()

  // Step 0: Filter conservative rhetorical redundancy
  const { redundantTargetIds } = filterRhetoricalRedundantTargets(universe.targets)
  for (const id of redundantTargetIds) {
    integrated.add(id)
  }

  const bySource = new Map(universe.targets.map(target => [target.sourceItemId, target]))
  const byTopic = new Map<string, ExamEnjoyerTarget[]>()
  for (const target of universe.targets) {
    const key = target.topicId || `material:${target.materialId}`
    byTopic.set(key, [...(byTopic.get(key) || []), target])
  }

  // Step 1: Explicit MULTI-SELECT groups
  // Formed when >=2 targets share an explicit set-membership relation to the same focal target X with the SAME predicate
  if (compact) {
    const relationsByGroup = new Map<string, Array<{ dep: ExamEnjoyerTarget; edge: ExamEnjoyerRelation; focal: ExamEnjoyerTarget; predicate: string }>>()
    for (const edge of universe.relations) {
      const dep = bySource.get(edge.fromSourceItemId)
      const focal = bySource.get(edge.toSourceItemId)
      if (!dep || !focal || integrated.has(dep.id)) continue
      if (!isExplicitSetRelation(edge, dep, focal)) continue
      const predicate = (edge.type || '').trim().toLowerCase()
      const key = `${focal.id}:${predicate}`
      relationsByGroup.set(key, [...(relationsByGroup.get(key) || []), { dep, edge, focal, predicate }])
    }

    for (const [groupKey, entries] of relationsByGroup) {
      const focal = entries[0].focal
      const predicate = entries[0].predicate
      const availableDeps = entries
        .map(e => e.dep)
        .filter(d => !integrated.has(d.id) && Boolean(conciseExcerpt(d.content, 180)))

      if (availableDeps.length >= 2) {
        const chunk = availableDeps.slice(0, 4) // 2 to 4 options
        const distractors = multiSelectDistractorsFor(chunk, universe, focal, predicate)
        if (distractors.length < 2) continue // ALWAYS require >= 2 defensible distractors

        const primary = chunk[0]
        const context = chunk.slice(1)
        const topicKey = focal.topicId || primary.topicId || primary.materialId
        const topicTitle = focal.topicTitle || primary.topicTitle || ''

        groups.push({
          primary,
          context,
          allAssessed: true,
          hintedTypes: ['multi_select'],
          topicKey,
          topicTitle,
          focalTarget: focal,
          predicate,
        })
        for (const t of chunk) integrated.add(t.id)
      }
    }
  }

  // Step 2: Explicit MATCHING groups (>= 3 pairs)
  // Structural matching from universe.relations (with explicit 1:1 association semantics)
  const availableEdges = universe.relations.filter(edge => {
    const p = bySource.get(edge.fromSourceItemId)
    const q = bySource.get(edge.toSourceItemId)
    return p && q && !integrated.has(p.id) && !integrated.has(q.id)
  })

  const edgesByGroup = new Map<string, typeof availableEdges>()
  for (const edge of availableEdges) {
    const p = bySource.get(edge.fromSourceItemId)!
    const q = bySource.get(edge.toSourceItemId)!
    if (!isExplicitMatchingAssociation(edge, p, q)) continue
    const edgeType = (edge.type || '').trim().toLowerCase()
    const key = `${p.topicId || `material:${p.materialId}`}:${edgeType}`
    edgesByGroup.set(key, [...(edgesByGroup.get(key) || []), edge])
  }

  for (const [groupKey, topicEdges] of edgesByGroup) {
    const topicKey = groupKey.split(':')[0]

    // 1. Ambiguity detection: check for 1:N or N:1 collisions across candidate edges
    const fromToRight = new Map<string, Set<string>>()
    const toToLeft = new Map<string, Set<string>>()

    for (const edge of topicEdges) {
      const fromTarget = bySource.get(edge.fromSourceItemId)
      const toTarget = bySource.get(edge.toSourceItemId)
      if (!fromTarget || !toTarget || integrated.has(fromTarget.id) || integrated.has(toTarget.id)) continue

      const left = fromTarget.label.trim()
      const right = (toTarget.kind === 'definition' || toTarget.content.length <= 180)
        ? conciseExcerpt(toTarget.content, 180)
        : toTarget.label.trim()

      if (!left || !right || left.length < 2 || right.length < 5) continue
      if (left.length > 50 || right.length > 180) continue
      if (left.toLowerCase() === right.toLowerCase()) continue

      if (!fromToRight.has(fromTarget.id)) fromToRight.set(fromTarget.id, new Set())
      fromToRight.get(fromTarget.id)!.add(toTarget.id)

      if (!toToLeft.has(toTarget.id)) toToLeft.set(toTarget.id, new Set())
      toToLeft.get(toTarget.id)!.add(fromTarget.id)
    }

    const ambiguousFrom = new Set<string>()
    for (const [fromId, rightSet] of fromToRight) {
      if (rightSet.size > 1) ambiguousFrom.add(fromId)
    }
    const ambiguousTo = new Set<string>()
    for (const [toId, leftSet] of toToLeft) {
      if (leftSet.size > 1) ambiguousTo.add(toId)
    }

    const seenFrom = new Set<string>()
    const seenTo = new Set<string>()
    const seenLeft = new Set<string>()
    const seenRight = new Set<string>()
    const validPairs: Array<{
      fromTarget: ExamEnjoyerTarget
      toTarget: ExamEnjoyerTarget
      left: string
      right: string
    }> = []

    for (const edge of topicEdges) {
      const fromTarget = bySource.get(edge.fromSourceItemId)
      const toTarget = bySource.get(edge.toSourceItemId)
      if (!fromTarget || !toTarget || integrated.has(fromTarget.id) || integrated.has(toTarget.id)) continue
      // Discard ambiguous endpoints
      if (ambiguousFrom.has(fromTarget.id) || ambiguousTo.has(toTarget.id)) continue
      if (seenFrom.has(fromTarget.id) || seenTo.has(toTarget.id)) continue

      const left = fromTarget.label.trim()
      const right = (toTarget.kind === 'definition' || toTarget.content.length <= 180)
        ? conciseExcerpt(toTarget.content, 180)
        : toTarget.label.trim()

      if (!left || !right || left.length < 2 || right.length < 5) continue
      if (left.length > 50 || right.length > 180) continue

      const normLeft = left.toLowerCase()
      const normRight = right.toLowerCase()
      if (normLeft === normRight) continue

      // No trivial lexical answer leakage
      if (normRight.startsWith(normLeft) || normRight.includes(` ${normLeft} `)) continue

      if (seenLeft.has(normLeft) || seenRight.has(normRight)) continue

      // Check near-duplicate pair semantics across existing valid pairs
      let hasDuplicateSemantics = false
      for (const existing of validPairs) {
        if (existing.right.toLowerCase() === normRight) {
          hasDuplicateSemantics = true
          break
        }
        const wordsExisting = new Set(existing.right.toLowerCase().split(/\s+/).filter(w => w.length > 3))
        const wordsCand = new Set(normRight.split(/\s+/).filter(w => w.length > 3))
        if (wordsExisting.size >= 4 && wordsCand.size >= 4) {
          let overlap = 0
          for (const w of wordsCand) {
            if (wordsExisting.has(w)) overlap++
          }
          const jaccard = overlap / (wordsExisting.size + wordsCand.size - overlap)
          if (jaccard > 0.75) {
            hasDuplicateSemantics = true
            break
          }
        }
      }
      if (hasDuplicateSemantics) continue

      seenFrom.add(fromTarget.id)
      seenTo.add(toTarget.id)
      seenLeft.add(normLeft)
      seenRight.add(normRight)
      validPairs.push({ fromTarget, toTarget, left, right })
    }

    if (validPairs.length >= 3) {
      const maxMatchingSize = compact ? 8 : 4
      const chunk = validPairs.slice(0, maxMatchingSize)
      const primary = chunk[0].fromTarget
      const context = chunk.slice(1).map(cp => cp.fromTarget)
      const partnerTargets = chunk.map(cp => cp.toTarget)
      const matchingPairs = chunk.map(cp => ({ left: cp.left, right: cp.right }))

      groups.push({
        primary,
        context,
        allAssessed: true,
        hintedTypes: ['matching'],
        topicKey,
        topicTitle: primary.topicTitle || '',
        matchingPairs,
        partnerTargets,
      })

      for (const cp of chunk) {
        integrated.add(cp.fromTarget.id)
        integrated.add(cp.toTarget.id)
      }
    }
  }

  // Step 3: Remaining relation edges -> Genuine composite SHORT-ANSWER only
  if (compact) {
    for (const edge of universe.relations) {
      const primary = bySource.get(edge.fromSourceItemId)
      const partner = bySource.get(edge.toSourceItemId)
      if (!primary || !partner || integrated.has(primary.id) || integrated.has(partner.id)) continue
      if (!requiresCompositeOpenEvidence(primary, partner, edge.type)) {
        continue // Leave atomic!
      }
      groups.push({
        primary, context: [partner], allAssessed: true, hintedTypes: ['short_answer'],
        topicKey: primary.topicId || primary.materialId, topicTitle: primary.topicTitle || '',
      })
      integrated.add(primary.id)
      integrated.add(partner.id)
    }
  }

  // Step 4: Remaining single targets (individual questions)
  for (const target of universe.targets) {
    if (integrated.has(target.id)) continue
    const topicKey = target.topicId || `material:${target.materialId}`
    const topicTitle = target.topicTitle || ''
    groups.push({
      primary: target,
      context: [],
      allAssessed: true,
      hintedTypes: target.examTypes,
      topicKey,
      topicTitle,
    })
    integrated.add(target.id)
  }

  return groups
}

/** Deterministic round-robin across topics — a time-bounded SAMPLE must
 * still be representative of the material, not exhaust one topic first. */
function orderGroupsForScopeSelection(groups: FullAssessmentGroup[]): FullAssessmentGroup[] {
  const byTopic = new Map<string, FullAssessmentGroup[]>()
  for (const group of groups) byTopic.set(group.topicKey, [...(byTopic.get(group.topicKey) || []), group])
  const ordered: FullAssessmentGroup[] = []
  while ([...byTopic.values()].some(list => list.length)) {
    for (const list of byTopic.values()) { const group = list.shift(); if (group) ordered.push(group) }
  }
  return ordered
}

function groupCost(group: FullAssessmentGroup, type: ExamQuestionType): number {
  return TYPE_SECONDS[type] + (type === 'short_answer' ? group.context.length * 45 : 0)
}

function chooseType(group: FullAssessmentGroup, index: number, selectedTypesSoFar?: ExamQuestionType[]): ExamQuestionType
function chooseType(group: FullAssessmentGroup, index: number, selectedTypesSoFar: ExamQuestionType[], remainingSeconds: number): ExamQuestionType | null
function chooseType(
  group: FullAssessmentGroup,
  index: number,
  selectedTypesSoFar: ExamQuestionType[] = [],
  remainingSeconds?: number,
): ExamQuestionType | null {
  const groupSize = 1 + group.context.length
  if (group.hintedTypes.includes('matching') && groupSize >= 3) {
    if (remainingSeconds !== undefined && groupCost(group, 'matching') > remainingSeconds) return null
    return 'matching'
  }
  if (group.hintedTypes.includes('multi_select') && groupSize >= 2) {
    if (remainingSeconds !== undefined && groupCost(group, 'multi_select') > remainingSeconds) return null
    return 'multi_select'
  }
  if (groupSize > 1) {
    if (remainingSeconds !== undefined && groupCost(group, 'short_answer') > remainingSeconds) return null
    return 'short_answer'
  }

  // Single-target question:
  if (!conciseExcerpt(group.primary.content)
    || ['application', 'critical_thinking', 'explanation'].includes(skillFor(group.primary))) {
    if (remainingSeconds !== undefined && groupCost(group, 'short_answer') > remainingSeconds) return null
    return 'short_answer'
  }

  const fillBlankUnit = extractFillBlankUnit(group.primary)
  const canFillBlank = fillBlankUnit !== null && (
    skillFor(group.primary) === 'retention'
    || fillBlankUnit.semanticClass === 'formula'
    || fillBlankUnit.semanticClass === 'year'
  )
  const canTrueFalse = isEligibleForTrueFalse(group.primary)

  const feasibleCandidates: ExamQuestionType[] = ['multiple_choice']
  if (canTrueFalse) feasibleCandidates.push('true_false')
  if (canFillBlank) feasibleCandidates.push('fill_blank')
  if (skillFor(group.primary) === 'comprehension' || skillFor(group.primary) === 'relation') {
    feasibleCandidates.push('short_answer')
  }

  // DURATION SUITABILITY: filter by remaining time budget before type preference
  const candidates = remainingSeconds !== undefined
    ? feasibleCandidates.filter(t => groupCost(group, t) <= remainingSeconds)
    : feasibleCandidates

  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  const counts: Record<string, number> = {}
  for (const t of selectedTypesSoFar) {
    counts[t] = (counts[t] || 0) + 1
  }

  const singleTypes: ExamQuestionType[] = ['multiple_choice', 'true_false', 'fill_blank', 'short_answer']
  const hinted = new Set(group.hintedTypes.filter(type => singleTypes.includes(type)))

  // Hierarchy: academic validity > independently gradable evidence > source grounding > duration suitability > type diversity > upstream type preference
  const sorted = [...candidates].sort((a, b) => {
    const diff = (counts[a] || 0) - (counts[b] || 0)
    if (diff !== 0) return diff
    const hintedA = hinted.has(a) ? 1 : 0
    const hintedB = hinted.has(b) ? 1 : 0
    if (hintedA !== hintedB) return hintedB - hintedA
    const hashA = stableHash(`${group.primary.id}:${a}`)
    const hashB = stableHash(`${group.primary.id}:${b}`)
    return hashA - hashB
  })

  return sorted[0]
}

const EXCERPT_MAX_CHARS = 180

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface FillBlankUnit {
  unit: string
  semanticClass: 'formula' | 'year' | 'term'
}

export function isMetadataLabel(text: string): boolean {
  if (!text) return false
  const trimmed = text.trim()
  return META_LABEL_PREFIX_RE.test(trimmed) || META_STANDALONE_RE.test(trimmed)
}

export function isTermSupportedByEvidence(term: string, target: Pick<ExamEnjoyerTarget, 'content' | 'sourceSpans'>): boolean {
  if (!term || !term.trim()) return false
  const cleanTerm = term.trim().toLowerCase()
  if (cleanTerm.length < 2) return false

  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(cleanTerm)}(?:[^\\p{L}\\p{N}]|$)`, 'iu')

  if (target.content && pattern.test(target.content)) {
    return true
  }
  if (Array.isArray(target.sourceSpans)) {
    for (const span of target.sourceSpans) {
      if (span?.quote && pattern.test(span.quote)) {
        return true
      }
    }
  }
  return false
}

export function isEligibleForTrueFalse(target: ExamEnjoyerTarget): boolean {
  if (!target || !target.content) return false

  const content = target.content.trim()
  // Bounded length: an atomic proposition must be concise and bounded
  if (content.length < 15 || content.length > 180) return false

  // Fail closed if source support is insufficient
  if (!Array.isArray(target.sourceSpans) || target.sourceSpans.length === 0) return false
  const hasValidQuote = target.sourceSpans.some(s => s?.quote && s.quote.trim().length >= 10)
  if (!hasValidQuote) return false

  const hasUncertainSupport = target.sourceSpans.some(s => s?.certainty === 'uncertain' || s?.certainty === 'inferred')
  if (hasUncertainSupport) return false

  // Fail closed if proposition is subjective, speculative or hedged
  const subjectiveRegex = /\b(?:podr[ií]a|podr[ií]an|quiz[aá]s?|tal\s+vez|probablemente|en\s+mi\s+opini[oó]n|a\s+mi\s+parecer|subjetiv[oa]|debatible|discutible|parece\s+ser|might|maybe|perhaps|probably|in\s+my\s+opinion|arguable|debatable)\b/i
  if (subjectiveRegex.test(content) || subjectiveRegex.test(target.label || '')) return false

  const subjectiveKinds = ['opinion', 'debate', 'discussion', 'case', 'argument']
  if (target.kind && subjectiveKinds.includes(target.kind.toLowerCase())) return false

  // Complex skills fail closed: application, critical_thinking, explanation require multi-step reasoning/judgment/calculations
  const skill = skillFor(target)
  if (['application', 'critical_thinking', 'explanation'].includes(skill)) return false

  // Must be an atomic proposition:
  // - No semicolons (joining independent clauses)
  if (content.includes(';')) return false
  // - No multiple sentences (protecting decimal points like 13.6 eV)
  const sentences = content.split(/(?<!\d)[.!?]+(?:\s+|$)/).map(s => s.trim()).filter(Boolean)
  if (sentences.length > 1) return false
  // - No multi-clause coordinating structures joining independent disputable claims
  if (/\s+(?:y\s+adem[aá]s|as[ií]\s+como\s+tambi[eé]n|por\s+otro\s+lado|sin\s+embargo|no\s+obstante|and\s+also|as\s+well\s+as)\s+/i.test(content)) return false
  // - No bullet points / newlines / incomplete questions
  if (content.includes('\n') || content.includes('...') || content.includes('?')) return false

  // Target kind must represent objective factual / definitional knowledge
  const objectiveKinds = ['fact', 'definition', 'formula', 'entity', 'axiom', 'law', 'concept', 'term']
  if (target.kind && !objectiveKinds.includes(target.kind.toLowerCase())) return false

  return true
}

export function extractFillBlankUnit(target: ExamEnjoyerTarget): FillBlankUnit | null {
  const content = (target.content || '').trim()
  const label = (target.label || '').trim()
  if (!content || !label) return null

  // Check pure metadata on label
  const cleanLabel = label.replace(/^(?:el|la|los|las|un|una|unos|unas)\s+/i, '').trim()
  if (META_STANDALONE_RE.test(label) || META_STANDALONE_RE.test(cleanLabel)) {
    return null
  }

  // Determine potential candidate & semantic class
  let candidate: string | null = null
  let semanticClass: 'formula' | 'year' | 'term' = 'term'

  const yearMatchInLabel = label.match(/\b(1\d{3}|20\d{2})\b/)
  const isDateFocus = /\b(fecha|a[nñ]o|year|date|nacimiento|presentaci[oó]n|creaci[oó]n|fundaci[oó]n|descubrimiento|publicaci[oó]n)\b/i.test(label)
  const yearMatchInContent = isDateFocus ? content.match(/\b(1\d{3}|20\d{2})\b/) : null

  const formulaNotation = /[\d=+*/^_{}\\<>⇌→Δ∑∫²³₀-₉−-]/u
  const formulaSymbol = /^(?:[A-Za-z]|[A-Z][A-Za-z])$/
  const isFormula = target.kind === 'formula'
    || target.id.toLowerCase().includes('formula')
    || target.label.toLowerCase().includes('formula')
    || target.label.toLowerCase().includes('fórmula')
    || (!isDateFocus && content.split(/\s+/).length <= 5 && content.length <= 35 && (formulaNotation.test(content) || formulaSymbol.test(content.trim())))
    || (!isDateFocus && /\$([^$]+)\$/.test(content))

  if (isFormula) {
    if (content.split(/\s+/).length <= 5 && content.length <= 35 && (formulaNotation.test(content) || formulaSymbol.test(content.trim()))) {
      candidate = content
      semanticClass = 'formula'
    } else {
      const latexMatch = content.match(/\$([^$]+)\$/)
      if (latexMatch && latexMatch[0].split(/\s+/).length <= 5 && latexMatch[0].length <= 35) {
        candidate = latexMatch[0]
        semanticClass = 'formula'
      } else {
        const strippedLabel = label.replace(META_LABEL_PREFIX_RE, '').trim()
        if (strippedLabel.split(/\s+/).length <= 5 && strippedLabel.length <= 35 && (formulaNotation.test(strippedLabel) || formulaSymbol.test(strippedLabel))) {
          candidate = strippedLabel
          semanticClass = 'formula'
        }
      }
    }
  } else if (yearMatchInLabel) {
    candidate = yearMatchInLabel[1]
    semanticClass = 'year'
  } else if (yearMatchInContent) {
    candidate = yearMatchInContent[1]
    semanticClass = 'year'
  } else {
    // Term candidate from label
    const stripped = label.replace(META_LABEL_PREFIX_RE, '').trim()
    candidate = stripped
    semanticClass = 'term'

    const isCleanTerm = target.kind === 'entity'
      || target.kind === 'term'
      || target.kind === 'concept'
      || target.kind === 'definition'
      || target.kind === 'fact'
      || skillFor(target) === 'retention'

    if (!isCleanTerm) return null
  }

  if (!candidate) return null

  // UNIFIED VALIDATION PIPELINE

  // 1. Metadata check on candidate
  const cleanCandidate = candidate.replace(/^(?:el|la|los|las|un|una|unos|unas)\s+/i, '').trim()
  if (isMetadataLabel(candidate) || META_STANDALONE_RE.test(candidate) || META_STANDALONE_RE.test(cleanCandidate)) {
    return null
  }

  // 2. Bounded unit check
  const maxWords = semanticClass === 'formula' ? 5 : 4
  const words = candidate.split(/\s+/)
  if (words.length < 1 || words.length > maxWords) return null
  if (candidate.length < 2 || candidate.length > 35) return null
  if (/[.!?]$/.test(candidate)) return null

  // 3. Strict source-evidence verification (applies to ALL classes: formulas, dates, terms)
  if (!isTermSupportedByEvidence(candidate, target)) {
    return null
  }

  // 4. Date ambiguity rejection
  if (semanticClass === 'year') {
    const contentYears = [...new Set(content.match(/\b(1\d{3}|20\d{2})\b/g) || [])]
    if (contentYears.length > 1 && !label.includes(candidate)) {
      return null
    }
  }

  // Enjoyer 'entity' does not distinguish people, places or organizations.
  // Do not reconstruct that missing distinction with a lexical classifier.
  if (semanticClass === 'term' && target.kind === 'entity') return null
  return { unit: candidate, semanticClass }
}

export function fillBlankDistractorsFor(
  universe: ExamEnjoyerUniverse,
  exclude: ExamEnjoyerTarget[],
  semanticClass: 'formula' | 'year' | 'term',
  canonical: string,
): string[] {
  const excludeIds = new Set(exclude.map(target => target.id))
  const normCanonical = canonical.toLowerCase().trim()
  const pool: string[] = []

  if (semanticClass === 'year') {
    const yearNum = parseInt(canonical, 10)
    for (const target of universe.targets) {
      if (excludeIds.has(target.id)) continue
      const y = target.content.match(/\b(1\d{3}|20\d{2})\b/)
      if (y && y[1] !== canonical && !pool.includes(y[1])) {
        pool.push(y[1])
      }
    }
    const uniqueYears = [...new Set(pool)]
    if (uniqueYears.length < 4 && !isNaN(yearNum) && yearNum >= 1000 && yearNum <= 2100) {
      const offsets = [-2, 5, -9, 8, 12, -15, 3]
      for (const off of offsets) {
        const alt = String(yearNum + off)
        if (alt !== canonical && !uniqueYears.includes(alt)) {
          uniqueYears.push(alt)
          if (uniqueYears.length >= 6) break
        }
      }
    }
    return uniqueYears.slice(0, 6)
  }

  if (semanticClass === 'formula') {
    for (const target of universe.targets) {
      if (excludeIds.has(target.id)) continue
      const unit = extractFillBlankUnit(target)
      if (unit && unit.semanticClass === 'formula') {
        const val = unit.unit.trim()
        if (val.toLowerCase() !== normCanonical && !pool.includes(val) && !isMetadataLabel(val) && val.split(/\s+/).length <= 5 && val.length <= 40 && !/[.!?]$/.test(val)) {
          pool.push(val)
        }
      }
    }
    return pool.slice(0, 6)
  }

  // semanticClass === 'term'
  for (const target of universe.targets) {
    if (excludeIds.has(target.id)) continue
    const unit = extractFillBlankUnit(target)
    if (unit && unit.semanticClass === 'term') {
      const val = unit.unit.trim()
      if (val.toLowerCase() !== normCanonical && !pool.includes(val) && !isMetadataLabel(val) && val.split(/\s+/).length <= 5 && val.length <= 40 && !/[.!?]$/.test(val)) {
        pool.push(val)
      }
    }
  }
  return pool.slice(0, 6)
}

function distractorsFor(exclude: ExamEnjoyerTarget[], universe: ExamEnjoyerUniverse, near: ExamEnjoyerTarget): string[] {
  const excludeIds = new Set(exclude.map(target => target.id))
  const sameTopic = universe.targets.filter(target => !excludeIds.has(target.id) && target.topicId === near.topicId)
  const others = universe.targets.filter(target => !excludeIds.has(target.id) && target.topicId !== near.topicId)
  // Never joined/concatenated — ONE bounded excerpt per candidate,
  // exactly the fix for the reported "·"-padded, source-dump distractor.
  const pool = [...sameTopic, ...others].map(target => conciseExcerpt(target.content, EXCERPT_MAX_CHARS))
  return [...new Set(pool.filter(Boolean))].slice(0, 6)
}

function answerAuthority(type: ExamQuestionType, group: FullAssessmentGroup, universe: ExamEnjoyerUniverse): ExamAnswerAuthority {
  const all = [group.primary, ...group.context]
  if (type === 'true_false') return { kind: 'boolean', value: true, canonicalStatement: conciseExcerpt(group.primary.content, EXCERPT_MAX_CHARS) }
  if (type === 'matching') {
    if (group.matchingPairs && group.matchingPairs.length >= 3) {
      return { kind: 'pairs', pairs: group.matchingPairs }
    }
    return { kind: 'pairs', pairs: all.map(target => ({ left: target.label, right: conciseExcerpt(target.content, 180) })) }
  }
  if (type === 'multi_select') {
    return {
      kind: 'multi_text',
      canonicalValues: all.map(target => conciseExcerpt(target.content, 180)),
      distractorPool: multiSelectDistractorsFor(all, universe, group.focalTarget || group.primary, group.predicate),
    }
  }
  if (type === 'short_answer') {
    const canonicalValue = all.length > 1
      ? all.map((target, i) => `Paso ${i + 1} (${target.label}): ${target.content}`).join('\n')
      : group.primary.content
    return {
      kind: 'single_text',
      canonicalValue,
      distractorPool: distractorsFor(all, universe, group.primary),
    }
  }
  if (type === 'fill_blank') {
    const unitInfo = extractFillBlankUnit(group.primary)
    const canonicalValue = unitInfo?.unit || ''

    return {
      kind: 'single_text',
      canonicalValue,
      distractorPool: [],
      ...(unitInfo ? { answerUnit: {
        semanticClass: unitInfo.semanticClass, sourceItemId: group.primary.sourceItemId,
        sourceSpans: group.primary.sourceSpans, content: group.primary.content, kind: group.primary.kind,
      } } : {}),
    }
  }
  return {
    kind: 'single_text',
    canonicalValue: conciseExcerpt(group.primary.content, EXCERPT_MAX_CHARS),
    distractorPool: distractorsFor(all, universe, group.primary),
  }
}

function roundToFive(minutes: number): number {
  return Math.max(5, Math.ceil(minutes / 5) * 5)
}

export const EXAM_SELECTABLE_DURATIONS = [15, 30, 45, 60, 90] as const
export type ExamSelectableDuration = typeof EXAM_SELECTABLE_DURATIONS[number]

/**
 * Normalizes any duration minutes to the supported Exam UI duration domain:
 * [15, 30, 45, 60, 90].
 * - If raw <= 15: returns 15
 * - If falls between supported options: returns the smallest supported duration that accommodates the workload
 * - If raw > 60: capped at 90
 */
export function normalizeSelectableDuration(rawMinutes: number): ExamSelectableDuration {
  if (rawMinutes === Infinity) return 90
  if (!Number.isFinite(rawMinutes) || rawMinutes <= 15) return 15
  return EXAM_SELECTABLE_DURATIONS.find(d => d >= rawMinutes) ?? 90
}

export function minimumSelectableDuration(minimumViableMinutes: number): ExamSelectableDuration {
  return normalizeSelectableDuration(minimumViableMinutes)
}

export interface ExamTimeBounds {
  minimumViableDurationMinutes: number
  minimumSelectableDurationMinutes?: number
  idealDurationMinutes: number
  rawIdealDurationMinutes?: number
  maximumUsefulDurationMinutes: number
}

/**
 * Informational-only recommendation shown BEFORE the user picks a
 * duration (mode=recommend) — the time an assessment of the material requires,
 * strictly normalized to the supported duration choices: [15, 30, 45, 60, 90].
 * minimumViableDurationMinutes is the minimum time needed to evaluate
 * 100% of the Enjoyer universe with legitimate multi-target groupings.
 */
export function computeExamEnjoyerTimeBounds(universe: ExamEnjoyerUniverse): ExamTimeBounds {
  const compactGroups = buildCandidateGroups(universe, true)
  const compactSeconds = compactGroups.reduce((sum, group, index) => sum + TYPE_SECONDS[chooseType(group, index)], 0)
  const minimumViableDurationMinutes = roundToFive(Math.ceil((compactSeconds / TIME_BUDGET_RATIO) / 60))

  const atomicGroups = buildCandidateGroups(universe, false)
  const atomicSeconds = atomicGroups.reduce((sum, group, index) => sum + TYPE_SECONDS[chooseType(group, index)], 0)
  const rawIdealDurationMinutes = Math.max(minimumViableDurationMinutes, roundToFive(Math.ceil((atomicSeconds / TIME_BUDGET_RATIO) / 60)))
  const idealDurationMinutes = normalizeSelectableDuration(rawIdealDurationMinutes)

  return {
    minimumViableDurationMinutes,
    minimumSelectableDurationMinutes: normalizeSelectableDuration(minimumViableDurationMinutes),
    idealDurationMinutes,
    rawIdealDurationMinutes,
    maximumUsefulDurationMinutes: Math.min(90, Math.max(15, idealDurationMinutes)),
  }
}

// Reserved share of the user's chosen duration held back for reading,
// navigation and review — the composer must never fill 100% of the
// clock with pure answering time.
const TIME_BUDGET_RATIO = 0.85

export function composeEnjoyerExamBlueprint(
  universe: ExamEnjoyerUniverse, requestedDurationMinutes: number, examId: string, seed: string,
): ExamBlueprint {
  const bounds = computeExamEnjoyerTimeBounds(universe)
  if (!Number.isFinite(requestedDurationMinutes) || requestedDurationMinutes < 1) throw new Error('INVALID_DURATION')
  const durationMinutes = requestedDurationMinutes
  const budgetSeconds = requestedDurationMinutes * 60 * TIME_BUDGET_RATIO
  // Preserve integrations at every duration. Additional time buys independent evidence
  // for important targets already integrated, rather than switching to a 1:1 universe.
  const candidates = orderGroupsForScopeSelection(buildCandidateGroups(universe, true))
  const selected: Array<{ group: FullAssessmentGroup; type: ExamQuestionType }> = []
  let remainingSeconds = budgetSeconds
  const cost = (group: FullAssessmentGroup, type: ExamQuestionType) =>
    TYPE_SECONDS[type] + (type === 'short_answer' ? group.context.length * 45 : 0)
  for (const group of candidates) {
    const type = chooseType(group, selected.length, selected.map(s => s.type), remainingSeconds)
    if (!type) continue
    selected.push({ group, type }); remainingSeconds -= cost(group, type)
  }
  if (requestedDurationMinutes >= 45) {
    const integrated = selected.flatMap(({ group }) => group.context.length ? [group.primary, ...group.context] : [])
      .filter(target => target.importance >= 70).sort((a, b) => b.importance - a.importance)
    for (const target of integrated) {
      const group: FullAssessmentGroup = { primary: target, context: [], allAssessed: true,
        hintedTypes: target.examTypes, topicKey: target.topicId || target.materialId, topicTitle: target.topicTitle || '' }
      const type = chooseType(group, selected.length, selected.map(s => s.type), remainingSeconds)
      if (!type) continue
      selected.push({ group, type }); remainingSeconds -= cost(group, type)
    }
  }

  const slots = selected.map(({ group, type }, index): ExamComposedSlot => {
    const all = [group.primary, ...group.context]
    const sourceItemIds = all.map(target => target.sourceItemId)
    const assessedTargetIds = group.allAssessed ? all.map(target => target.id) : [group.primary.id]
    const contextTargetIds = group.allAssessed ? [] : group.context.map(target => target.id)
    const readingBudgetWords = all.reduce((sum, target) => sum + wordCount(target.content), 0)
    const authority = answerAuthority(type, group, universe)
    const evidenceSources = [...new Map([...all, ...(group.partnerTargets || []),
      ...(group.focalTarget ? [group.focalTarget] : []),
      ...universe.relations.filter(relation => relation.type === 'dependsOn' && sourceItemIds.includes(relation.fromSourceItemId))
        .slice(0, 2).flatMap(relation => universe.targets.filter(target => target.sourceItemId === relation.toSourceItemId)),
    ].map(target => [target.sourceItemId, target])).values()]
    const evidenceIds = new Set(evidenceSources.map(target => target.sourceItemId))
    const slotId = `exam_slot:${stableHash(`${seed}:${sourceItemIds.join('|')}:${type}`).toString(16)}`
    return {
      authoringContractVersion: 2,
      evidenceRelations: universe.relations.filter(relation => evidenceIds.has(relation.fromSourceItemId) && evidenceIds.has(relation.toSourceItemId)),
      assessmentCriteria: all.filter(target => assessedTargetIds.includes(target.id)).map((target, componentIndex) => ({
        criterionId: `${slotId}:criterion:${target.sourceItemId}`, targetIds: [target.id],
        operation: type === 'matching' ? 'compare' : operationForSkill(skillFor(target)),
        canonicalCriterion: type === 'short_answer' ? target.content : authority.kind === 'single_text' ? authority.canonicalValue : authority.kind === 'boolean' ? authority.canonicalStatement : authority.kind === 'pairs' ? (authority.pairs[componentIndex]?.right || conciseExcerpt(target.content, 180)) : authority.canonicalValues[componentIndex],
        gradingMode: type === 'short_answer' ? 'semantic' : 'deterministic', points: examQuestionPoints(type) / assessedTargetIds.length,
        skill: type === 'matching' ? 'relation' : skillFor(target),
        label: type === 'matching' && authority.kind === 'pairs' ? (authority.pairs[componentIndex]?.left || target.label) : target.label,
        sourceItemId: target.sourceItemId, pages: target.pages, materialId: target.materialId, componentIndex,
      })),
      id: `exam_slot:${stableHash(`${seed}:${sourceItemIds.join('|')}:${type}`).toString(16)}`,
      primaryTargetId: group.primary.id,
      contextTargetIds,
      targetIds: all.map(target => target.id),
      assessedTargetIds,
      sourceItemIds,
      type,
      cognitiveLevel: cognitiveLevel(type),
      skill: type === 'matching' ? 'relation' : skillFor(group.primary),
      cognitiveOperation: type === 'matching' ? 'compare' : operationForSkill(skillFor(group.primary)),
      assessmentFocus: group.focalTarget?.label || group.primary.label,
      difficulty: difficultyFor(all),
      estimatedSeconds: TYPE_SECONDS[type] + (type === 'short_answer' ? group.context.length * 45 : 0),
      readingBudgetWords,
      answerAuthority: authority,
      frozenSources: evidenceSources.map(target => ({
        kind: target.kind, topicId: target.topicId, topicTitle: target.topicTitle,
        misconceptions: target.misconceptions, bloomLevel: target.bloomLevel, examTypeHints: target.rawExamTypeHints,
        sourceItemId: target.sourceItemId, label: target.label, content: target.content,
        materialId: target.materialId, pages: target.pages, sourceSpans: target.sourceSpans,
      })),
      topicId: group.primary.topicId,
      topicTitle: group.primary.topicTitle,
      order: index,
      sourceAffordances: group.primary.sourceAffordances || classifySourceAffordances(group.primary),
      setPredicate: group.predicate,
    }
  }).sort((a, b) => stableHash(`${seed}:${a.id}`) - stableHash(`${seed}:${b.id}`))
    .map((slot, order) => ({ ...slot, order }))

  const representedTargetIds = [...new Set(slots.flatMap(slot => slot.targetIds))]
  const assessedTargetIds = [...new Set(slots.flatMap(slot => slot.assessedTargetIds))]
  const contextOnlySet = new Set(representedTargetIds.filter(id => !assessedTargetIds.includes(id)))
  const assessedSet = new Set(assessedTargetIds)
  const notAssessedDueToScopeTargetIds = universe.targets.map(target => target.id)
    .filter(id => !assessedSet.has(id) && !contextOnlySet.has(id))
  const coveredSourceItemIds = [...new Set(slots.flatMap(slot => slot.sourceItemIds))]
  const coveredSources = new Set(coveredSourceItemIds)
  const uncoveredSourceItemIds = universe.targets.map(target => target.sourceItemId).filter(id => !coveredSources.has(id))
  const assessedCoveragePercent = Math.round((assessedSet.size / universe.targets.length) * 10000) / 100
  // Legacy "representation" accounting — kept ONLY for backward-
  // compatible callers, never surfaced as "assessed" in the UI anymore.
  const represented = new Set(representedTargetIds)
  const uncoveredTargetIds = universe.targets.map(target => target.id).filter(id => !represented.has(id))
  const coveragePercent = Math.round((represented.size / universe.targets.length) * 10000) / 100
  const topicCoverage = universe.topics.map(topic => {
    const targets = universe.targets.filter(target => target.topicId === topic.id)
    return { topicId: topic.id, topicTitle: topic.title, assessed: targets.filter(target => assessedSet.has(target.id)).length, total: targets.length }
  })
  const coverage: ExamCoverageMetadata = {
    consideredTargetIds: universe.targets.map(target => target.id),
    criterionTargetIds: assessedTargetIds,
    sufficientEvidenceTargetIds: [], // Sufficiency is a result of graded evidence, never generation.
    totalUniverseTargets: universe.targets.length,
    assessedTargetIds,
    contextOnlyTargetIds: [...contextOnlySet],
    notAssessedDueToScopeTargetIds,
    assessedCoveragePercent,
    coverageStatus: notAssessedDueToScopeTargetIds.length ? 'scoped_sample' : 'complete',
    topicCoverage,
    totalAssessableTargets: universe.targets.length,
    representedTargetIds,
    uncoveredTargetIds,
    totalEvaluableTargets: universe.targets.length,
    coveredTargets: coveredSourceItemIds.length,
    coveredSourceItemIds,
    uncoveredSourceItemIds,
    coveragePercent,
  }
  const typeDistribution = Object.fromEntries(EXAM_TYPES.map(type => [type, slots.filter(slot => slot.type === type).length])) as Record<ExamQuestionType, number>
  const difficultyDistribution = Object.fromEntries((['basic', 'medium', 'advanced'] as const)
    .map(difficulty => [difficulty, slots.filter(slot => slot.difficulty === difficulty).length])) as Record<ExamDifficulty, number>
  const skillDistribution = Object.fromEntries((['retention', 'comprehension', 'application', 'critical_thinking', 'relation', 'explanation'] as const)
    .map(skill => [skill, slots.filter(slot => slot.skill === skill).length])) as Record<ExamSkill, number>
  return {
    targetUniverse: universe.targets.map(target => ({ targetId: target.id, label: target.label, pages: target.pages, materialId: target.materialId, canonicalRequirement: target.content })),
    schemaVersion: 4,
    authorityType: EXAM_ENJOYER_AUTHORITY_TYPE,
    authorityVersion: EXAM_ENJOYER_AUTHORITY_VERSION,
    generatorVersion: EXAM_ENJOYER_GENERATOR_VERSION,
    examId,
    fingerprint: universe.fingerprint,
    requestedDurationMinutes,
    durationMinutes,
    effectiveDurationMinutes: durationMinutes,
    idealDurationMinutes: bounds.idealDurationMinutes,
    minimumViableDurationMinutes: bounds.minimumViableDurationMinutes,
    seed,
    materialLanguage: universe.materialLanguage,
    slots,
    totalExamTargets: universe.targets.length,
    representedTargetIds,
    typeDistribution,
    difficultyDistribution,
    skillDistribution,
    expectedCompletionSeconds: slots.reduce((sum, slot) => sum + slot.estimatedSeconds, 0),
    totalReadingBudgetWords: slots.reduce((sum, slot) => sum + slot.readingBudgetWords, 0),
    coveragePercent,
    coverage,
  }
}

export const EXAM_AUTHORING_BOUNDS = {
  MAX_LABEL_CHARS: 120,
  MAX_CONTENT_CHARS: 500,
  MAX_SOURCE_SPANS: 3,
  MAX_SPAN_QUOTE_CHARS: 240,
  MAX_MISCONCEPTIONS: 3,
  MAX_MISCONCEPTION_CHARS: 240,
  MAX_RELATIONS_PER_SLOT: 4,
  MAX_RELATION_TYPE_CHARS: 40,
  MAX_RELATION_ID_CHARS: 60,
  MAX_CANONICAL_VALUE_CHARS: 180,
  MAX_CRITERION_CHARS: 300,
} as const

export function renderExamEnjoyerContext(slots: readonly ExamComposedSlot[]): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const source of slots.flatMap(slot => slot.frozenSources)) {
    if (seen.has(source.sourceItemId)) continue
    seen.add(source.sourceItemId)
    lines.push(`[EXAM_SOURCE ${source.sourceItemId}]`)
    const boundedLabel = String(source.label || '').slice(0, EXAM_AUTHORING_BOUNDS.MAX_LABEL_CHARS)
    lines.push(`TITLE: ${boundedLabel}`)
    const boundedContent = String(source.content || '').slice(0, EXAM_AUTHORING_BOUNDS.MAX_CONTENT_CHARS)
    lines.push(`CONTENT: ${boundedContent}`)
    if (source.kind) lines.push(`KIND: ${source.kind}`)
    if (source.topicId) lines.push(`TOPIC: ${JSON.stringify({ id: source.topicId, title: source.topicTitle })}`)
    if (source.sourceSpans.length) {
      const boundedSpans = source.sourceSpans.slice(0, EXAM_AUTHORING_BOUNDS.MAX_SOURCE_SPANS).map(span => ({
        page: span.page,
        quote: String(span.quote || '').slice(0, EXAM_AUTHORING_BOUNDS.MAX_SPAN_QUOTE_CHARS),
        ...(span.certainty ? { certainty: span.certainty } : {}),
      }))
      lines.push(`SOURCE_EVIDENCE: ${JSON.stringify(boundedSpans)}`)
    }
    if (source.misconceptions?.length) {
      const boundedMisconceptions = source.misconceptions
        .slice(0, EXAM_AUTHORING_BOUNDS.MAX_MISCONCEPTIONS)
        .map(m => String(m || '').slice(0, EXAM_AUTHORING_BOUNDS.MAX_MISCONCEPTION_CHARS))
      lines.push(`MISCONCEPTIONS: ${JSON.stringify(boundedMisconceptions)}`)
    }
    if (source.bloomLevel) lines.push(`BLOOM: ${source.bloomLevel}`)
    if (source.examTypeHints?.length) lines.push(`SOURCE_HINTS: ${JSON.stringify(source.examTypeHints)}`)
    if (source.pages.length) lines.push(`MATERIAL: ${source.materialId} PAGES: ${source.pages.join(',')}`)
    lines.push('')
  }
  for (const slot of slots) {
    if (slot.evidenceRelations?.length) {
      const boundedRelations = slot.evidenceRelations
        .slice(0, EXAM_AUTHORING_BOUNDS.MAX_RELATIONS_PER_SLOT)
        .map(r => ({
          type: String(r.type || '').slice(0, EXAM_AUTHORING_BOUNDS.MAX_RELATION_TYPE_CHARS),
          from: String(r.fromSourceItemId || '').slice(0, EXAM_AUTHORING_BOUNDS.MAX_RELATION_ID_CHARS),
          to: String(r.toSourceItemId || '').slice(0, EXAM_AUTHORING_BOUNDS.MAX_RELATION_ID_CHARS),
        }))
      lines.push(`SLOT_RELATIONS ${slot.id}: ${JSON.stringify(boundedRelations)}`)
    }
    if (slot.answerAuthority.kind === 'single_text' && slot.answerAuthority.answerUnit) {
      const { semanticClass, sourceItemId, kind } = slot.answerAuthority.answerUnit
      const canonicalValue = String(slot.answerAuthority.canonicalValue || '').slice(0, EXAM_AUTHORING_BOUNDS.MAX_CANONICAL_VALUE_CHARS)
      lines.push(`PRIVATE_ANSWER_UNIT ${slot.id}: ${JSON.stringify({ canonicalValue, semanticClass, sourceItemId, kind })}`)
    }
  }
  return lines.join('\n')
}
