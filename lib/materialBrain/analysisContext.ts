import type { ImportanceTier, KnowledgeRelation, KnowledgeUnit, KnowledgeUnitKind, MaterialBrain } from './types'
import { computeGroundedCoverage, liveKnowledgeUnits, liveRelationsAmong, primaryEvidenceFor } from './groundedContext'

// ============================================================
// Análisis Teórico grounded context — Análisis-specific, built on top
// of the shared groundedContext.ts primitives (also used by Repasar's
// reviewContext.ts). Not a reuse of RepasarReviewTarget: Análisis needs
// relation-clustered narrative grouping and per-evidence traceability
// that Repasar's flat one-target-per-unit model doesn't need.
// ============================================================

export interface AnalysisTargetEvidenceRow {
  materialId: string | null
  page: number | null
  derivation: 'native_text' | 'ocr' | 'vision' | null
  evidenceText: string | null
}

export interface AnalysisTarget {
  id: string
  unitIds: string[]
  primaryUnitId: string
  kind: KnowledgeUnitKind
  importanceTier: ImportanceTier
  materialId: string | null
  pages: number[]
  label: string
  statement: string
  evidence: AnalysisTargetEvidenceRow[]
  relationIds: string[]
}

/** The deterministic denominator: one AnalysisTarget per surviving Brain unit. */
export function buildAnalysisTargets(brain: MaterialBrain): AnalysisTarget[] {
  const units = liveKnowledgeUnits(brain)
  const unitIds = new Set(units.map(unit => unit.id))
  const relations = liveRelationsAmong(unitIds, brain.relations || [])
  const relationIdsByUnit = new Map<string, string[]>()
  for (const relation of relations) {
    relationIdsByUnit.set(relation.fromUnitId, [...(relationIdsByUnit.get(relation.fromUnitId) || []), relation.id])
    relationIdsByUnit.set(relation.toUnitId, [...(relationIdsByUnit.get(relation.toUnitId) || []), relation.id])
  }

  return units.map(unit => {
    const evidenceRows: AnalysisTargetEvidenceRow[] = (unit.evidence && unit.evidence.length ? unit.evidence : []).map(evidence => ({
      materialId: evidence.materialId,
      page: evidence.page,
      derivation: evidence.derivation,
      evidenceText: evidence.derivation === 'vision' ? (evidence.description || null) : (evidence.quote || null),
    }))
    const primary = primaryEvidenceFor(unit)
    const rows = evidenceRows.length ? evidenceRows : [primary]
    const pages = Array.from(new Set(rows.map(row => row.page).filter((page): page is number => page != null))).sort((a, b) => a - b)
    return {
      id: unit.id,
      unitIds: [unit.id],
      primaryUnitId: unit.id,
      kind: unit.kind,
      importanceTier: unit.importance.tier,
      materialId: primary.materialId,
      pages,
      label: unit.label,
      statement: unit.statement,
      evidence: rows,
      relationIds: (relationIdsByUnit.get(unit.id) || []).sort(),
    }
  })
}

export interface AnalysisRelationRow {
  id: string
  type: string
  statement: string
  fromTargetId: string
  toTargetId: string
}

export interface AnalysisNarrativeCluster {
  id: string
  targetIds: string[]
  primaryTargetId: string
  relationIds: string[]
  kindsPresent: KnowledgeUnitKind[]
}

const TIER_RANK: Record<ImportanceTier, number> = { critical: 0, supporting: 1, contextual: 2 }

/**
 * Groups AnalysisTargets into pedagogical clusters using ONLY real
 * relation edges (connected components over the relation graph) —
 * deterministic, no provider call, no arbitrary grouping to hit a
 * target count. A target with no relations becomes its own
 * single-target cluster.
 */
export function buildAnalysisNarrativeClusters(brain: MaterialBrain, targets: readonly AnalysisTarget[]): AnalysisNarrativeCluster[] {
  const targetById = new Map(targets.map(target => [target.id, target]))
  const targetIds = new Set(targets.map(target => target.id))
  const relations = liveRelationsAmong(targetIds, brain.relations || [])

  const parent = new Map<string, string>()
  for (const target of targets) parent.set(target.id, target.id)
  function find(id: string): string {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root) as string
    let cursor = id
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
  for (const relation of relations) union(relation.fromUnitId, relation.toUnitId)

  const groups = new Map<string, string[]>()
  for (const target of targets) {
    const root = find(target.id)
    groups.set(root, [...(groups.get(root) || []), target.id])
  }

  const clusters: AnalysisNarrativeCluster[] = []
  for (const [root, memberIds] of groups) {
    const sortedIds = [...memberIds].sort()
    const idSet = new Set(sortedIds)
    const relationIds = relations
      .filter(relation => idSet.has(relation.fromUnitId) && idSet.has(relation.toUnitId))
      .map(relation => relation.id)
      .sort()
    const primaryTargetId = [...sortedIds].sort((a, b) => {
      const tierDiff = TIER_RANK[targetById.get(a)!.importanceTier] - TIER_RANK[targetById.get(b)!.importanceTier]
      return tierDiff !== 0 ? tierDiff : a.localeCompare(b)
    })[0]
    clusters.push({
      id: `cluster:${root}`,
      targetIds: sortedIds,
      primaryTargetId,
      relationIds,
      kindsPresent: Array.from(new Set(sortedIds.map(id => targetById.get(id)!.kind))),
    })
  }
  clusters.sort((a, b) => a.primaryTargetId.localeCompare(b.primaryTargetId))
  return clusters
}

export interface AnalysisGroundedContext {
  fingerprint: string
  builderVersion: string
  targets: AnalysisTarget[]
  clusters: AnalysisNarrativeCluster[]
  relations: AnalysisRelationRow[]
}

export function buildAnalysisGroundedContext(brain: MaterialBrain): AnalysisGroundedContext {
  const targets = buildAnalysisTargets(brain)
  const clusters = buildAnalysisNarrativeClusters(brain, targets)
  const targetIds = new Set(targets.map(target => target.id))
  const relations = liveRelationsAmong(targetIds, brain.relations || []).map(relation => ({
    id: relation.id, type: relation.type, statement: relation.statement,
    fromTargetId: relation.fromUnitId, toTargetId: relation.toUnitId,
  }))
  return { fingerprint: brain.scope.fingerprint, builderVersion: brain.meta.builderVersion, targets, clusters, relations }
}

/**
 * Structured, cluster-organized prompt block. Every fact is tagged with
 * its ANALYSIS_TARGET id so a provider response can only reference ids
 * we handed it (validated server-side; unknown ids are dropped, never
 * trusted as coverage or authority).
 */
export function renderAnalysisGroundedContext(context: AnalysisGroundedContext, maxChars = 90000): string {
  const targetById = new Map(context.targets.map(target => [target.id, target]))
  const relationById = new Map(context.relations.map(relation => [relation.id, relation]))
  const lines: string[] = []
  for (const cluster of context.clusters) {
    lines.push(`[CLUSTER ${cluster.id}] kinds=${cluster.kindsPresent.join(',')}`)
    for (const targetId of cluster.targetIds) {
      const target = targetById.get(targetId)
      if (!target) continue
      lines.push(`  [ANALYSIS_TARGET ${target.id}]`)
      lines.push(`  UNIT_IDS: ${target.unitIds.join(', ')}`)
      lines.push(`  KIND: ${target.kind}`)
      lines.push(`  IMPORTANCE: ${target.importanceTier}`)
      lines.push(`  LABEL: ${target.label}`)
      lines.push(`  CONTENIDO AUTORIZADO: ${target.statement}`)
      if (target.pages.length) lines.push(`  PAGES: material=${target.materialId || '?'} paginas=${target.pages.join(',')}`)
      const evidenceLines = target.evidence.filter(row => row.evidenceText)
      if (evidenceLines.length) {
        lines.push('  EVIDENCE:')
        for (const row of evidenceLines) lines.push(`    - (${row.derivation || 'desconocida'}) "${row.evidenceText}"`)
      }
      if (target.relationIds.length) lines.push(`  RELATION_IDS: ${target.relationIds.join(', ')}`)
    }
    if (cluster.relationIds.length) {
      lines.push('  RELATIONS:')
      for (const relationId of cluster.relationIds) {
        const relation = relationById.get(relationId)
        if (relation) lines.push(`    - [${relation.id}] ${relation.fromTargetId} --${relation.type}--> ${relation.toTargetId}: ${relation.statement}`)
      }
    }
    lines.push('')
  }
  const rendered = lines.join('\n')
  if (rendered.length <= maxChars) return rendered
  return rendered.slice(0, maxChars) + '\n\n[Contexto recortado para el análisis]'
}

export interface AnalysisCoverageResult {
  totalAnalysisTargets: number
  representedAnalysisTargets: number
  coveragePercent: number
  missingTargetIds: string[]
}

/**
 * Deterministic coverage: denominator is always every AnalysisTarget id
 * from THIS Brain; anything the provider claims outside that set is
 * dropped before counting. A narrative cluster legitimately represents
 * several targets at once — no requirement that every target gets its
 * own paragraph, only that its id is traceably represented somewhere.
 */
export function computeAnalysisCoverage(
  targets: readonly AnalysisTarget[],
  representedTargetIds: readonly string[],
): AnalysisCoverageResult {
  const generic = computeGroundedCoverage(targets.map(target => target.id), representedTargetIds)
  return {
    totalAnalysisTargets: generic.totalTargets,
    representedAnalysisTargets: generic.representedTargets,
    coveragePercent: generic.coveragePercent,
    missingTargetIds: generic.missingTargetIds,
  }
}

export type AnalysisExamProbability = 'alta' | 'media' | 'baja'

/**
 * Deterministic exam-likelihood signal — replaces the old free LLM
 * guess. Rule (documented, not tunable at runtime):
 *  - "alta": critical tier, OR supporting tier with >=2 relations (well-connected concept).
 *  - "media": supporting tier (not already alta), OR contextual tier with >=2 relations.
 *  - "baja": everything else (contextual, weakly connected).
 */
export function analysisExamProbability(target: AnalysisTarget): AnalysisExamProbability {
  if (target.importanceTier === 'critical') return 'alta'
  if (target.importanceTier === 'supporting') return target.relationIds.length >= 2 ? 'alta' : 'media'
  return target.relationIds.length >= 2 ? 'media' : 'baja'
}

export interface DeterministicCoberturaItem { elemento: string; por_que_importa: string; targetIds: string[] }
export interface DeterministicParaExamenItem { punto: string; por_que: string; targetIds: string[] }
export interface DeterministicProbabilidadItem { concepto: string; probabilidad: AnalysisExamProbability; razon: string; targetId: string }

/** cobertura_material — every non-contextual target, derived directly from the Brain, no provider call. */
export function deterministicCoberturaMaterial(targets: readonly AnalysisTarget[]): DeterministicCoberturaItem[] {
  return targets
    .filter(target => target.importanceTier !== 'contextual')
    .map(target => ({ elemento: target.label, por_que_importa: target.statement, targetIds: [target.id] }))
}

/** para_examen — critical targets, plus well-connected supporting targets. */
export function deterministicParaExamen(targets: readonly AnalysisTarget[]): DeterministicParaExamenItem[] {
  return targets
    .filter(target => analysisExamProbability(target) === 'alta')
    .map(target => ({ punto: target.label, por_que: target.statement, targetIds: [target.id] }))
}

/** probabilidad_examen — one deterministic row per target (see analysisExamProbability). */
export function deterministicProbabilidadExamen(targets: readonly AnalysisTarget[]): DeterministicProbabilidadItem[] {
  return targets.map(target => {
    const probabilidad = analysisExamProbability(target)
    const razon = probabilidad === 'alta'
      ? (target.importanceTier === 'critical' ? 'Concepto marcado crítico por el Material Brain.' : 'Concepto de apoyo con múltiples relaciones — bien conectado al resto del material.')
      : probabilidad === 'media'
        ? 'Concepto de apoyo o contextual con conexiones moderadas.'
        : 'Concepto contextual con poca conexión al resto del material.'
    return { concepto: target.label, probabilidad, razon, targetId: target.id }
  })
}

/** ya_puedes_explicar — critical + well-connected supporting target labels, capped for UI readability. */
export function deterministicYaPuedesExplicar(targets: readonly AnalysisTarget[], limit = 12): string[] {
  return targets
    .filter(target => analysisExamProbability(target) !== 'baja')
    .slice(0, limit)
    .map(target => target.label)
}
