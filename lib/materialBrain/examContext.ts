import type { ImportanceTier, KnowledgeUnit, KnowledgeUnitKind, MaterialBrain, RelationType } from './types'
import { computeGroundedCoverage, connectedComponents, liveKnowledgeUnits, liveRelationsAmong, primaryEvidenceFor } from './groundedContext'

// ============================================================
// Modo Examen — StudyAL-as-professor composer. Product contract:
// the student chooses ONLY time; StudyAL (this module) deterministically
// decides question count, types, difficulty curve, and target grouping.
// The composer's ONE hard invariant: every eligible ExamTarget is
// represented in exactly one frozen ExamSlot BEFORE any provider call —
// less time compresses (groups targets into fewer, denser slots), never
// drops targets. No LLM is involved in composing the blueprint.
// ============================================================

export type ExamQuestionType = 'multiple_choice' | 'true_false' | 'fill_blank' | 'short_answer' | 'multi_select' | 'matching'
export type ExamCognitiveLevel = 'recall' | 'discrimination' | 'integration'
export type ExamDifficulty = 'basic' | 'medium' | 'advanced'

export interface ExamTargetEvidenceRow {
  materialId: string | null
  page: number | null
  derivation: 'native_text' | 'ocr' | 'vision' | null
  evidenceText: string | null
}

export interface ExamTarget {
  id: string
  unitIds: string[]
  kind: KnowledgeUnitKind
  importanceTier: ImportanceTier
  materialId: string | null
  pages: number[]
  label: string
  statement: string
  evidence: ExamTargetEvidenceRow[]
  /** Canonical short answer value this target can anchor (term, blank value, TF-true paraphrase base). Server-authored, never provider-decided. */
  canonicalValue: string
  relationIds: string[]
}

function evidenceRowsFor(unit: KnowledgeUnit): ExamTargetEvidenceRow[] {
  const rows = (unit.evidence && unit.evidence.length ? unit.evidence : []).map(evidence => ({
    materialId: evidence.materialId, page: evidence.page, derivation: evidence.derivation,
    evidenceText: evidence.derivation === 'vision' ? (evidence.description || null) : (evidence.quote || null),
  }))
  if (rows.length) return rows
  const primary = primaryEvidenceFor(unit)
  return [primary]
}

function pagesFromEvidence(rows: ExamTargetEvidenceRow[]): number[] {
  return Array.from(new Set(rows.map(row => row.page).filter((page): page is number => page != null))).sort((a, b) => a - b)
}

function isEligibleUnit(unit: KnowledgeUnit): boolean {
  if (unit.kind === 'process') return false // no grounded sequence/step type yet — disclosed limitation
  return Boolean(unit.statement && unit.statement.trim().length >= 10)
}

/** Denominator — one ExamTarget per eligible live unit. Never "every unit"; process-kind and empty-statement units are excluded (documented). */
export function buildExamTargets(brain: MaterialBrain): ExamTarget[] {
  const units = liveKnowledgeUnits(brain).filter(isEligibleUnit)
  const unitIds = new Set(units.map(unit => unit.id))
  const relations = liveRelationsAmong(unitIds, brain.relations || [])
  const relationIdsByUnit = new Map<string, string[]>()
  for (const relation of relations) {
    relationIdsByUnit.set(relation.fromUnitId, [...(relationIdsByUnit.get(relation.fromUnitId) || []), relation.id])
    relationIdsByUnit.set(relation.toUnitId, [...(relationIdsByUnit.get(relation.toUnitId) || []), relation.id])
  }
  return units.map(unit => {
    const evidence = evidenceRowsFor(unit)
    const primary = primaryEvidenceFor(unit)
    return {
      id: `unit:${unit.id}`, unitIds: [unit.id], kind: unit.kind, importanceTier: unit.importance.tier,
      materialId: primary.materialId, pages: pagesFromEvidence(evidence), label: unit.label, statement: unit.statement,
      evidence, canonicalValue: unit.label, relationIds: (relationIdsByUnit.get(unit.id) || []).sort(),
    }
  })
}

// ============================================================
// Candidate slots — every legitimate way to assess the target universe,
// BEFORE any time budget is applied. "Single" candidates cover 1 target
// (least compressed); "aggregate" candidates (matching/multi_select)
// cover several targets in one slot (compression).
// ============================================================

export interface ExamCandidateSlot {
  id: string
  targetIds: string[]
  type: ExamQuestionType
  cognitiveLevel: ExamCognitiveLevel
  estimatedSeconds: number
  /** Server-authoritative answer identity — the provider may phrase, never decide, this. */
  answerAuthority: ExamAnswerAuthority
}

export type ExamAnswerAuthority =
  | { kind: 'single_text'; canonicalValue: string; distractorPool: string[] }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'multi_text'; canonicalValues: string[]; distractorPool: string[] }
  | { kind: 'pairs'; pairs: { left: string; right: string }[] }

const BASE_SECONDS: Record<ExamQuestionType, number> = {
  true_false: 20, multiple_choice: 30, fill_blank: 25, short_answer: 60, multi_select: 20, matching: 15,
}

function cognitiveLevelFor(type: ExamQuestionType): ExamCognitiveLevel {
  if (type === 'fill_blank' || type === 'short_answer') return 'recall'
  if (type === 'multi_select' || type === 'matching') return 'integration'
  return 'discrimination'
}

function eligibleSingleTypesForTarget(target: ExamTarget): ExamQuestionType[] {
  const types: ExamQuestionType[] = ['true_false', 'short_answer']
  if (target.kind !== 'example') types.push('multiple_choice')
  if (target.kind === 'formula' || target.kind === 'definition' || target.kind === 'terminology') types.push('fill_blank')
  return types
}

/** Least-compressed candidate: one target, a deterministically-varied eligible single type (realistic type mix, not always the same type). */
function singleCandidateFor(target: ExamTarget, allTargets: readonly ExamTarget[], preferredType?: ExamQuestionType): ExamCandidateSlot {
  const eligible = eligibleSingleTypesForTarget(target)
  const type = preferredType && eligible.includes(preferredType) ? preferredType : eligible[stableHash(target.id) % eligible.length]
  const distractorPool = allTargets.filter(t => t.id !== target.id && t.kind === target.kind).map(t => t.canonicalValue).slice(0, 6)
  const answerAuthority: ExamAnswerAuthority = type === 'true_false'
    ? { kind: 'boolean', value: true }
    : { kind: 'single_text', canonicalValue: target.canonicalValue, distractorPool }
  return {
    id: `single:${target.id}:${type}`, targetIds: [target.id], type, cognitiveLevel: cognitiveLevelFor(type),
    estimatedSeconds: BASE_SECONDS[type], answerAuthority,
  }
}

/** Matching candidates: chunks of 3-5 terminology/definition targets, paired term(label) -> canonical definition(statement). No relation required — the pairing is the unit's own identity. */
function buildMatchingCandidates(targets: readonly ExamTarget[]): ExamCandidateSlot[] {
  const eligible = targets.filter(t => t.kind === 'terminology' || t.kind === 'definition').sort((a, b) => a.id.localeCompare(b.id))
  const candidates: ExamCandidateSlot[] = []
  for (let i = 0; i < eligible.length; i += 4) {
    const chunk = eligible.slice(i, i + 4)
    if (chunk.length < 3) break // too few for a legitimate matching question — leave as singles
    candidates.push({
      id: `matching:${chunk.map(t => t.id).join(',')}`, targetIds: chunk.map(t => t.id), type: 'matching',
      cognitiveLevel: 'integration', estimatedSeconds: BASE_SECONDS.matching * chunk.length + 15,
      answerAuthority: { kind: 'pairs', pairs: chunk.map(t => ({ left: t.label, right: t.canonicalValue })) },
    })
  }
  return candidates
}

/** Multi-select candidates: a hub target connected to >=2 others via causes/depends_on/part_of — "select all X connected to Y", correctness = real relation membership. */
function buildMultiSelectCandidates(targets: readonly ExamTarget[], brain: MaterialBrain): ExamCandidateSlot[] {
  const targetByUnitId = new Map(targets.flatMap(target => target.unitIds.map(unitId => [unitId, target])))
  const unitIds = new Set(targets.flatMap(target => target.unitIds))
  const AGGREGATE_TYPES: RelationType[] = ['causes', 'depends_on', 'part_of']
  const relations = liveRelationsAmong(unitIds, brain.relations || []).filter(r => AGGREGATE_TYPES.includes(r.type))
  const childrenByHub = new Map<string, Set<string>>()
  for (const relation of relations) {
    if (!childrenByHub.has(relation.fromUnitId)) childrenByHub.set(relation.fromUnitId, new Set())
    childrenByHub.get(relation.fromUnitId)!.add(relation.toUnitId)
  }
  const candidates: ExamCandidateSlot[] = []
  const usedHubs = Array.from(childrenByHub.keys()).sort()
  for (const hubUnitId of usedHubs) {
    const childUnitIds = Array.from(childrenByHub.get(hubUnitId)!).sort().slice(0, 5)
    if (childUnitIds.length < 2) continue
    const hubTarget = targetByUnitId.get(hubUnitId)
    const childTargets = childUnitIds.map(id => targetByUnitId.get(id)).filter((t): t is ExamTarget => !!t)
    if (!hubTarget || childTargets.length < 2) continue
    const groupTargetIds = [hubTarget.id, ...childTargets.map(t => t.id)]
    const distractorPool = targets.filter(t => !groupTargetIds.includes(t.id) && t.kind === childTargets[0].kind).map(t => t.canonicalValue).slice(0, 4)
    candidates.push({
      id: `multi_select:${hubTarget.id}:${childTargets.map(t => t.id).join(',')}`, targetIds: groupTargetIds, type: 'multi_select',
      cognitiveLevel: 'integration', estimatedSeconds: BASE_SECONDS.multi_select + 15 * childTargets.length,
      answerAuthority: { kind: 'multi_text', canonicalValues: childTargets.map(t => t.canonicalValue), distractorPool },
    })
  }
  return candidates
}

export interface ExamCandidatePool {
  singles: Map<string, ExamCandidateSlot> // targetId -> single candidate
  aggregates: ExamCandidateSlot[] // matching + multi_select, sorted by capacity desc (most compressing first)
}

export function buildExamCandidatePool(targets: readonly ExamTarget[], brain: MaterialBrain): ExamCandidatePool {
  const singles = new Map(targets.map(target => [target.id, singleCandidateFor(target, targets)]))
  const aggregates = [...buildMatchingCandidates(targets), ...buildMultiSelectCandidates(targets, brain)]
    .sort((a, b) => b.targetIds.length - a.targetIds.length || a.id.localeCompare(b.id))
  return { singles, aggregates }
}

/**
 * Tightest legitimate blueprint: greedily apply the largest aggregate
 * candidates first (each covering several targets in one slot), then
 * fill any still-uncovered targets with singles. This is the MAXIMUM
 * compression StudyAL can legitimately produce — defines
 * minimumViableDurationMinutes. Always covers 100% of targets.
 */
function buildTightestSlots(targets: readonly ExamTarget[], pool: ExamCandidatePool): ExamCandidateSlot[] {
  const covered = new Set<string>()
  const slots: ExamCandidateSlot[] = []
  for (const aggregate of pool.aggregates) {
    if (aggregate.targetIds.some(id => covered.has(id))) continue
    slots.push(aggregate)
    for (const id of aggregate.targetIds) covered.add(id)
  }
  for (const target of targets) {
    if (covered.has(target.id)) continue
    slots.push(pool.singles.get(target.id)!)
    covered.add(target.id)
  }
  return slots
}

/** Loosest legitimate blueprint: one single-target slot per target — zero compression. Defines idealDurationMinutes' upper structure. */
function buildLoosestSlots(targets: readonly ExamTarget[], pool: ExamCandidatePool): ExamCandidateSlot[] {
  return targets.map(target => pool.singles.get(target.id)!)
}

function totalSeconds(slots: readonly ExamCandidateSlot[]): number {
  return slots.reduce((sum, slot) => sum + slot.estimatedSeconds, 0)
}

export interface ExamTimeBounds {
  minimumViableDurationMinutes: number
  idealDurationMinutes: number
  maximumUsefulDurationMinutes: number
}

export function computeExamTimeBounds(targets: readonly ExamTarget[], brain: MaterialBrain): ExamTimeBounds {
  if (!targets.length) return { minimumViableDurationMinutes: 0, idealDurationMinutes: 0, maximumUsefulDurationMinutes: 0 }
  const pool = buildExamCandidatePool(targets, brain)
  const tightest = buildTightestSlots(targets, pool)
  const loosest = buildLoosestSlots(targets, pool)
  const minMinutes = Math.max(5, Math.ceil(totalSeconds(tightest) / 60 / 5) * 5)
  const idealMinutes = Math.max(minMinutes, Math.ceil(totalSeconds(loosest) / 60 / 5) * 5)
  // Useful upper bound: ideal + room for deeper/short-answer-heavy
  // decompression, capped so a huge duration selection never produces
  // pointless filler duplication.
  const maxMinutes = Math.min(180, idealMinutes + 30)
  return { minimumViableDurationMinutes: minMinutes, idealDurationMinutes: idealMinutes, maximumUsefulDurationMinutes: maxMinutes }
}

// ============================================================
// Composer — deterministic time -> slots. Starts from the tightest
// (fully compressed) blueprint and DECOMPRESSES by splitting the
// largest aggregate slots back into singles until the estimated total
// time is as close as possible to the requested duration without
// exceeding it (or, above idealDuration, uses the loosest blueprint —
// no filler beyond that). Coverage is 100% at every step because
// splitting an aggregate replaces it with singles for the SAME targets.
// ============================================================

function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 0x01000193) }
  return hash >>> 0
}

export interface ExamBlueprint {
  examId: string
  fingerprint: string
  requestedDurationMinutes: number
  durationMinutes: number
  idealDurationMinutes: number
  minimumViableDurationMinutes: number
  seed: string
  slots: ExamComposedSlot[]
  totalExamTargets: number
  representedTargetIds: string[]
  typeDistribution: Record<ExamQuestionType, number>
  difficultyDistribution: Record<ExamDifficulty, number>
  expectedCompletionSeconds: number
  coveragePercent: number
}

export interface ExamComposedSlot extends ExamCandidateSlot {
  difficulty: ExamDifficulty
  order: number
}

function difficultyForSlot(slot: ExamCandidateSlot, targetByIdMap: Map<string, ExamTarget>): ExamDifficulty {
  const tiers = slot.targetIds.map(id => targetByIdMap.get(id)?.importanceTier)
  const hasCritical = tiers.includes('critical')
  if (slot.cognitiveLevel === 'integration') return hasCritical ? 'advanced' : 'medium'
  if (slot.cognitiveLevel === 'recall') return hasCritical ? 'medium' : 'basic'
  return hasCritical ? 'advanced' : 'medium'
}

export function composeExamBlueprint(brain: MaterialBrain, requestedDurationMinutes: number, examId: string, seed: string): ExamBlueprint {
  const targets = buildExamTargets(brain)
  const targetById = new Map(targets.map(target => [target.id, target]))
  const bounds = computeExamTimeBounds(targets, brain)
  const pool = buildExamCandidatePool(targets, brain)

  let slots: ExamCandidateSlot[];
  if (!targets.length) {
    slots = []
  } else if (requestedDurationMinutes >= bounds.idealDurationMinutes) {
    slots = buildLoosestSlots(targets, pool)
  } else {
    // Start fully compressed, decompress (split largest aggregates first)
    // until adding the next split would exceed the requested budget.
    slots = buildTightestSlots(targets, pool)
    const budgetSeconds = Math.max(requestedDurationMinutes, bounds.minimumViableDurationMinutes) * 60
    let guard = 0
    while (totalSeconds(slots) < budgetSeconds && guard++ < targets.length * 2) {
      const aggregateIndex = slots
        .map((slot, index) => ({ slot, index }))
        .filter(({ slot }) => slot.type === 'matching' || slot.type === 'multi_select')
        .sort((a, b) => b.slot.targetIds.length - a.slot.targetIds.length || a.slot.id.localeCompare(b.slot.id))[0]?.index
      if (aggregateIndex === undefined) break
      const [aggregate] = slots.splice(aggregateIndex, 1)
      const replacement = aggregate.targetIds.map(id => pool.singles.get(id)!)
      const nextTotal = totalSeconds(slots) + totalSeconds(replacement)
      if (nextTotal > budgetSeconds && totalSeconds(slots) + aggregate.estimatedSeconds >= budgetSeconds - 30) {
        slots.push(aggregate); break // splitting would overshoot more than keeping compressed — stop here
      }
      slots.push(...replacement)
    }
  }

  const orderedSlots = [...slots].sort((a, b) => stableHash(`${seed}:${a.id}`) - stableHash(`${seed}:${b.id}`))
  const composed: ExamComposedSlot[] = orderedSlots.map((slot, index) => ({
    ...slot, order: index, difficulty: difficultyForSlot(slot, targetById),
  }))

  const representedTargetIds = Array.from(new Set(composed.flatMap(slot => slot.targetIds)))
  const coverage = computeGroundedCoverage(targets.map(target => target.id), representedTargetIds)

  const typeDistribution = {} as Record<ExamQuestionType, number>
  const difficultyDistribution = {} as Record<ExamDifficulty, number>
  for (const slot of composed) {
    typeDistribution[slot.type] = (typeDistribution[slot.type] || 0) + 1
    difficultyDistribution[slot.difficulty] = (difficultyDistribution[slot.difficulty] || 0) + 1
  }

  const expectedCompletionSeconds = totalSeconds(composed)
  return {
    examId, fingerprint: brain.scope.fingerprint, requestedDurationMinutes,
    durationMinutes: Math.max(requestedDurationMinutes, bounds.minimumViableDurationMinutes),
    idealDurationMinutes: bounds.idealDurationMinutes, minimumViableDurationMinutes: bounds.minimumViableDurationMinutes,
    seed, slots: composed, totalExamTargets: targets.length, representedTargetIds,
    typeDistribution, difficultyDistribution, expectedCompletionSeconds,
    coveragePercent: coverage.coveragePercent,
  }
}

/** Structured, id-tagged prompt block for exactly the blueprint's slots/targets — never the whole Brain. */
export function renderExamGroundedContext(targets: readonly ExamTarget[]): string {
  const lines: string[] = []
  for (const target of targets) {
    lines.push(`[EXAM_TARGET ${target.id}] kind=${target.kind} importance=${target.importanceTier}`)
    lines.push(`LABEL: ${target.label}`)
    lines.push(`CONTENIDO AUTORIZADO: ${target.statement}`)
    const evidenceLines = target.evidence.filter(row => row.evidenceText)
    if (evidenceLines.length) {
      lines.push('EVIDENCE:')
      for (const row of evidenceLines) lines.push(`  - (${row.derivation || 'desconocida'}) "${row.evidenceText}"`)
    }
    if (target.pages.length) lines.push(`PAGES: material=${target.materialId || '?'} paginas=${target.pages.join(',')}`)
    lines.push('')
  }
  return lines.join('\n')
}
