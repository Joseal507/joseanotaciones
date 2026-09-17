import type { ImportanceTier, KnowledgeUnit, KnowledgeUnitKind, MaterialBrain, RelationType } from './types'
import { computeGroundedCoverage, liveKnowledgeUnits, liveRelationsAmong, primaryEvidenceFor } from './groundedContext'

// ============================================================
// Truquitos grounded context — Truquitos-specific, built on the shared
// groundedContext.ts primitives (also used by Repasar/Análisis/Study
// Map). Truquitos' own contract: NOT every KnowledgeUnit deserves a
// pedagogical trick — eligibility is derived from real Brain structure
// (unit kind, relation type, importance), and the provider may invent
// NOVEL mnemonic/analogy wording while the underlying academic facts
// (targetIds, evidence, pages, relation identity) stay fixed.
// ============================================================

export type TruquitoStrategy =
  | 'mnemonic' | 'contrast' | 'pattern' | 'step_memory'
  | 'formula_memory' | 'error_warning' | 'association' | 'exam_cue'

export interface TruquitoTargetEvidenceRow {
  materialId: string | null
  page: number | null
  derivation: 'native_text' | 'ocr' | 'vision' | null
  evidenceText: string | null
}

export interface TruquitoTarget {
  id: string
  unitIds: string[]
  relationIds: string[]
  kind: KnowledgeUnitKind | 'contrast_pair' | 'causal_pair' | 'formula_application' | 'example_pair'
  importanceTier: ImportanceTier
  materialId: string | null
  pages: number[]
  label: string
  statement: string
  evidence: TruquitoTargetEvidenceRow[]
  strategyOpportunities: TruquitoStrategy[]
}

/**
 * Which pedagogical strategies a single unit's own structure legitimately
 * supports. Documented, deterministic rule — NOT every kind gets every
 * strategy:
 *  - terminology/definition → mnemonic + association (a term/definition is memorizable).
 *  - formula → formula_memory (there's a real formula to anchor a memory device to).
 *  - process with >=2 real steps → step_memory (an ordered sequence exists).
 *  - critical importance → exam_cue (Brain already flagged this as exam-relevant).
 * A plain `fact`/`concept`/`example`/`event_or_data` unit with no critical
 * tier gets NO unit-level strategy — it only becomes eligible if a
 * relation gives it one (see relationOpportunities below).
 */
function unitOpportunities(unit: KnowledgeUnit): TruquitoStrategy[] {
  const strategies: TruquitoStrategy[] = []
  if (unit.kind === 'terminology' || unit.kind === 'definition') strategies.push('mnemonic', 'association')
  if (unit.kind === 'formula') strategies.push('formula_memory')
  if (unit.kind === 'process' && Array.isArray((unit as any).steps) && (unit as any).steps.length >= 2) strategies.push('step_memory')
  if (unit.importance.tier === 'critical') strategies.push('exam_cue')
  return strategies
}

function evidenceRowsFor(unit: KnowledgeUnit): TruquitoTargetEvidenceRow[] {
  const rows = (unit.evidence && unit.evidence.length ? unit.evidence : []).map(evidence => ({
    materialId: evidence.materialId, page: evidence.page, derivation: evidence.derivation,
    evidenceText: evidence.derivation === 'vision' ? (evidence.description || null) : (evidence.quote || null),
  }))
  if (rows.length) return rows
  const primary = primaryEvidenceFor(unit)
  return [primary]
}

function pagesFromEvidence(rows: TruquitoTargetEvidenceRow[]): number[] {
  return Array.from(new Set(rows.map(row => row.page).filter((page): page is number => page != null))).sort((a, b) => a - b)
}

/**
 * Which pedagogical strategies a RELATION legitimately supports —
 * requires both endpoints to be live units. Documented rule:
 *  - contrasts_with → contrast + error_warning (a real academic contrast to compare/avoid confusing).
 *  - causes / precedes → pattern (a real causal/sequential chain to narrate).
 *  - applies_formula → formula_memory (a real link between a formula and its application).
 *  - example_of → association (a real concept-to-example link).
 * depends_on/part_of/defined_by alone do not, by themselves, generate a
 * NEW strategy beyond what the unit already has — they are structural,
 * not memorable per se.
 */
const RELATION_OPPORTUNITIES: Partial<Record<RelationType, { strategies: TruquitoStrategy[]; kind: TruquitoTarget['kind'] }>> = {
  contrasts_with: { strategies: ['contrast', 'error_warning'], kind: 'contrast_pair' },
  causes: { strategies: ['pattern'], kind: 'causal_pair' },
  precedes: { strategies: ['pattern'], kind: 'causal_pair' },
  applies_formula: { strategies: ['formula_memory'], kind: 'formula_application' },
  example_of: { strategies: ['association'], kind: 'example_pair' },
}

/** The deterministic denominator: eligible unit-level targets + eligible relation-pair targets — never "every unit". */
export function buildTruquitoTargets(brain: MaterialBrain): TruquitoTarget[] {
  const units = liveKnowledgeUnits(brain)
  const unitIds = new Set(units.map(unit => unit.id))
  const unitById = new Map(units.map(unit => [unit.id, unit]))
  const relations = liveRelationsAmong(unitIds, brain.relations || [])

  const targets: TruquitoTarget[] = []

  for (const unit of units) {
    const strategies = unitOpportunities(unit)
    if (!strategies.length) continue
    const evidence = evidenceRowsFor(unit)
    const primary = primaryEvidenceFor(unit)
    targets.push({
      id: `unit:${unit.id}`, unitIds: [unit.id], relationIds: [], kind: unit.kind,
      importanceTier: unit.importance.tier, materialId: primary.materialId, pages: pagesFromEvidence(evidence),
      label: unit.label, statement: unit.statement, evidence, strategyOpportunities: strategies,
    })
  }

  for (const relation of relations) {
    if (relation.fromUnitId === relation.toUnitId) continue
    const opportunity = RELATION_OPPORTUNITIES[relation.type]
    if (!opportunity) continue
    const fromUnit = unitById.get(relation.fromUnitId)
    const toUnit = unitById.get(relation.toUnitId)
    if (!fromUnit || !toUnit) continue
    const evidence = [...evidenceRowsFor(fromUnit), ...evidenceRowsFor(toUnit)]
    const primary = primaryEvidenceFor(fromUnit)
    const tier: ImportanceTier = fromUnit.importance.tier === 'critical' || toUnit.importance.tier === 'critical' ? 'critical' : 'supporting'
    targets.push({
      id: `relation:${relation.id}`, unitIds: [relation.fromUnitId, relation.toUnitId], relationIds: [relation.id],
      kind: opportunity.kind, importanceTier: tier, materialId: primary.materialId, pages: pagesFromEvidence(evidence),
      label: `${fromUnit.label} ↔ ${toUnit.label}`, statement: relation.statement, evidence,
      strategyOpportunities: opportunity.strategies,
    })
  }

  return targets
}

export interface TruquitosRelationRow {
  id: string
  type: RelationType
  statement: string
  fromUnitId: string
  toUnitId: string
}

export interface TruquitosGroundedContext {
  fingerprint: string
  builderVersion: string
  targets: TruquitoTarget[]
  relations: TruquitosRelationRow[]
}

export function buildTruquitosGroundedContext(brain: MaterialBrain): TruquitosGroundedContext {
  const targets = buildTruquitoTargets(brain)
  const unitIds = new Set(liveKnowledgeUnits(brain).map(unit => unit.id))
  const relations = liveRelationsAmong(unitIds, brain.relations || []).map(relation => ({
    id: relation.id, type: relation.type, statement: relation.statement,
    fromUnitId: relation.fromUnitId, toUnitId: relation.toUnitId,
  }))
  return { fingerprint: brain.scope.fingerprint, builderVersion: brain.meta.builderVersion, targets, relations }
}

/**
 * Batch size for a SINGLE generation call — a real token-budget
 * constraint, not a product quantity decision. `totalEligibleTargets` in
 * coverage always reflects the FULL eligible set regardless of this cap,
 * so coverage honestly reports <100% if a Brain has more eligible
 * targets than fit in one batch. Diversity-first selection: one target
 * per (kind, strategy) pair before repeating, critical tier prioritized.
 */
export function selectTruquitoTargetsForBatch(targets: readonly TruquitoTarget[], maxBatch = 24): TruquitoTarget[] {
  const sorted = [...targets].sort((a, b) => {
    const tierRank = (t: ImportanceTier) => (t === 'critical' ? 0 : t === 'supporting' ? 1 : 2)
    const tierDiff = tierRank(a.importanceTier) - tierRank(b.importanceTier)
    return tierDiff !== 0 ? tierDiff : a.id.localeCompare(b.id)
  })
  return sorted.slice(0, maxBatch)
}

/** Structured, id-tagged prompt block — cheap, only the eligible batch, never the whole Brain. */
export function renderTruquitosGroundedContext(targets: readonly TruquitoTarget[]): string {
  const lines: string[] = []
  for (const target of targets) {
    lines.push(`[TRUQUITO_TARGET ${target.id}] kind=${target.kind} importance=${target.importanceTier}`)
    lines.push(`ESTRATEGIAS ELEGIBLES: ${target.strategyOpportunities.join(', ')}`)
    lines.push(`LABEL: ${target.label}`)
    lines.push(`CONTENIDO AUTORIZADO: ${target.statement}`)
    const evidenceLines = target.evidence.filter(row => row.evidenceText)
    if (evidenceLines.length) {
      lines.push('EVIDENCE:')
      for (const row of evidenceLines) lines.push(`  - (${row.derivation || 'desconocida'}) "${row.evidenceText}"`)
    }
    if (target.pages.length) lines.push(`PAGES: material=${target.materialId || '?'} paginas=${target.pages.join(',')}`)
    if (target.relationIds.length) lines.push(`RELATION_IDS: ${target.relationIds.join(', ')}`)
    lines.push('')
  }
  return lines.join('\n')
}

export interface TruquitosCoverageResult {
  totalEligibleTargets: number
  representedEligibleTargets: number
  coveragePercent: number
  missingTargetIds: string[]
}

/** Deterministic coverage over the ELIGIBLE universe only — never "all Brain units". Provider never decides the denominator. */
export function computeTruquitosCoverage(
  eligibleTargets: readonly TruquitoTarget[],
  representedTargetIds: readonly string[],
): TruquitosCoverageResult {
  const generic = computeGroundedCoverage(eligibleTargets.map(target => target.id), representedTargetIds)
  return {
    totalEligibleTargets: generic.totalTargets,
    representedEligibleTargets: generic.representedTargets,
    coveragePercent: generic.coveragePercent,
    missingTargetIds: generic.missingTargetIds,
  }
}

export interface TruquitoCardCandidate {
  type: string
  title: string
  content: string
  targetIds: string[]
  relationIds: string[]
}

/**
 * Target-identity dedup: two cards covering the EXACT same target set
 * (regardless of wording) are semantic duplicates — keep the first
 * (batch order is already diversity-sorted, so "first" is the
 * highest-priority target combination). Complements, does not replace,
 * the existing text-similarity ranking in the route.
 */
export function dedupeTruquitosByTargetIdentity<T extends TruquitoCardCandidate>(cards: readonly T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const card of cards) {
    const key = `${card.type}::${[...card.targetIds].sort().join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(card)
  }
  return result
}
