import type { KnowledgeRelation, KnowledgeUnit, MaterialBrain } from './types'

// ============================================================
// Tool-agnostic Material Brain primitives. Extracted from
// reviewContext.ts (Repasar) so a second grounded-context consumer
// (Análisis) doesn't duplicate the same unit/evidence/relation
// plumbing a third time. Deliberately minimal: nothing here encodes
// Repasar- or Análisis-specific semantics (review targets, narrative
// clusters, coverage field names, prompt phrasing all stay in their
// own tool-specific modules).
// ============================================================

/** Units still authoritative — excludes anything superseded/merged away. */
export function liveKnowledgeUnits(brain: MaterialBrain): KnowledgeUnit[] {
  return brain.units.filter(unit => !unit.supersededBy)
}

export interface GroundedEvidenceSummary {
  materialId: string | null
  page: number | null
  derivation: 'native_text' | 'ocr' | 'vision' | null
  evidenceText: string | null
}

/** The first evidence entry for a unit, normalized to a flat summary (vision uses `description`, text uses `quote`). */
export function primaryEvidenceFor(unit: KnowledgeUnit): GroundedEvidenceSummary {
  const evidence = unit.evidence?.[0]
  if (evidence) {
    const evidenceText = evidence.derivation === 'vision'
      ? (evidence.description || null)
      : (evidence.quote || null)
    return { materialId: evidence.materialId, page: evidence.page, derivation: evidence.derivation, evidenceText }
  }
  const provenance = unit.provenance?.[0]
  if (provenance) {
    return { materialId: provenance.materialId, page: provenance.page, derivation: 'native_text', evidenceText: provenance.quote || null }
  }
  return { materialId: null, page: null, derivation: null, evidenceText: null }
}

/** Relations whose both endpoints are still live/known — never a dangling reference. */
export function liveRelationsAmong(
  liveUnitIds: ReadonlySet<string>,
  relations: readonly KnowledgeRelation[],
): KnowledgeRelation[] {
  return relations.filter(relation => liveUnitIds.has(relation.fromUnitId) && liveUnitIds.has(relation.toUnitId))
}

export interface GroundedCoverageResult {
  totalTargets: number
  representedTargets: number
  coveragePercent: number
  missingTargetIds: string[]
}

/**
 * Deterministic coverage math shared by every tool that grounds against
 * Material Brain: the denominator is always the caller's own known-id
 * list; any id in `representedTargetIdsRaw` that isn't in that list is
 * silently dropped — a provider (or external knowledge) can never grow
 * the denominator or claim representation of a target that doesn't exist.
 */
/**
 * Connected components over an arbitrary id/edge graph (union-find,
 * deterministic). Generic on purpose — used today by Study Map's
 * relation-based visual clustering; Análisis keeps its own inline
 * clustering (not refactored onto this, to avoid touching a file the
 * Análisis migration already stabilized).
 */
export function connectedComponents(
  nodeIds: readonly string[],
  edges: readonly { from: string; to: string }[],
): string[][] {
  const parent = new Map<string, string>()
  for (const id of nodeIds) parent.set(id, id)
  function find(x: string): string {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root) as string
    let cursor = x
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor) as string
      parent.set(cursor, root)
      cursor = next
    }
    return root
  }
  function union(a: string, b: string): void {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootA, rootB)
  }
  for (const edge of edges) {
    if (parent.has(edge.from) && parent.has(edge.to)) union(edge.from, edge.to)
  }
  const groups = new Map<string, string[]>()
  for (const id of nodeIds) {
    const root = find(id)
    groups.set(root, [...(groups.get(root) || []), id])
  }
  return Array.from(groups.values()).map(ids => [...ids].sort())
}

export function computeGroundedCoverage(
  knownTargetIds: readonly string[],
  representedTargetIdsRaw: readonly string[],
): GroundedCoverageResult {
  const known = new Set(knownTargetIds)
  const represented = new Set(representedTargetIdsRaw.filter(id => known.has(id)))
  const total = knownTargetIds.length
  return {
    totalTargets: total,
    representedTargets: represented.size,
    coveragePercent: total > 0 ? Math.round((represented.size / total) * 100) : 0,
    missingTargetIds: knownTargetIds.filter(id => !represented.has(id)),
  }
}
