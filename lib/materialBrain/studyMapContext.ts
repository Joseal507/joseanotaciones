import type { ImportanceTier, KnowledgeUnitKind, MaterialBrain, RelationType } from './types'
import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'
import { computeGroundedCoverage, connectedComponents, liveKnowledgeUnits, liveRelationsAmong, primaryEvidenceFor } from './groundedContext'

// ============================================================
// Study Map grounded context — Study-Map-specific, built on the shared
// groundedContext.ts primitives (also used by Repasar's reviewContext.ts
// and Análisis's analysisContext.ts). Study Map's own contract: nodes and
// edges come ENTIRELY from Material Brain units/relations, deterministic,
// no provider call required to build the map at all.
// ============================================================

export interface StudyMapNode {
  id: string
  unitId: string
  kind: KnowledgeUnitKind
  importanceTier: ImportanceTier
  materialId: string | null
  pages: number[]
  label: string
  statement: string
  derivation: 'native_text' | 'ocr' | 'vision' | null
  evidenceText: string | null
}

/** Deterministic display-label cleanup — whitespace/bullet normalization only, never changes meaning or authority. */
function cleanDisplayLabel(label: string): string {
  return String(label || '').trim().replace(/\s+/g, ' ').replace(/^[-•*]\s*/, '')
}

/** The deterministic node universe: one StudyMapNode per surviving Brain unit. */
export function buildStudyMapNodes(brain: MaterialBrain): StudyMapNode[] {
  return liveKnowledgeUnits(brain).map(unit => {
    const evidenceRows = unit.evidence && unit.evidence.length ? unit.evidence : []
    const primary = primaryEvidenceFor(unit)
    const pages = Array.from(new Set(
      evidenceRows.map(row => row.page).filter((page): page is number => page != null),
    )).sort((a, b) => a - b)
    return {
      id: unit.id,
      unitId: unit.id,
      kind: unit.kind,
      importanceTier: unit.importance.tier,
      materialId: primary.materialId,
      pages: pages.length ? pages : (primary.page != null ? [primary.page] : []),
      label: cleanDisplayLabel(unit.label),
      statement: unit.statement,
      derivation: primary.derivation,
      evidenceText: primary.evidenceText,
    }
  })
}

export interface StudyMapEdge {
  id: string
  relationId: string
  sourceUnitId: string
  targetUnitId: string
  type: RelationType
  label: string
}

/**
 * Academic edges — ONLY real Material Brain relations. Structural
 * cleanup only (never alters an academically legitimate relation):
 *  - drops self-relations (fromUnitId === toUnitId);
 *  - drops dangling relations (endpoint not a live node) via liveRelationsAmong;
 *  - dedupes exact (from, type, to) duplicates, keeping the
 *    lowest-relationId occurrence for determinism.
 */
export function buildStudyMapEdges(brain: MaterialBrain, nodes: readonly StudyMapNode[]): StudyMapEdge[] {
  const knownIds = new Set(nodes.map(node => node.id))
  const live = liveRelationsAmong(knownIds, brain.relations || [])
  const noSelfRelations = live.filter(relation => relation.fromUnitId !== relation.toUnitId)
  const sorted = [...noSelfRelations].sort((a, b) => a.id.localeCompare(b.id))
  const seen = new Set<string>()
  const edges: StudyMapEdge[] = []
  for (const relation of sorted) {
    const key = `${relation.fromUnitId}::${relation.type}::${relation.toUnitId}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({
      id: relation.id, relationId: relation.id, sourceUnitId: relation.fromUnitId,
      targetUnitId: relation.toUnitId, type: relation.type, label: relation.statement,
    })
  }
  return edges
}

export interface StudyMapVisualCluster {
  id: string
  kind: 'relation_component' | 'kind_group'
  nodeIds: string[]
}

/**
 * Visual grouping only — NEVER an academic claim. A cluster is either a
 * connected component of real relation edges (semantically coherent) or,
 * for the leftover unrelated nodes, a fallback grouping by `kind` purely
 * so isolated nodes aren't rendered as unstructured spaghetti. Neither
 * form invents a relationship between nodes that don't have one.
 */
export function buildStudyMapVisualClusters(nodes: readonly StudyMapNode[], edges: readonly StudyMapEdge[]): StudyMapVisualCluster[] {
  const nodeIds = nodes.map(node => node.id)
  const components = connectedComponents(nodeIds, edges.map(edge => ({ from: edge.sourceUnitId, to: edge.targetUnitId })))
  const clusters: StudyMapVisualCluster[] = []
  const singleNodeIdsByKind = new Map<string, string[]>()
  for (const component of components) {
    if (component.length > 1) {
      clusters.push({ id: `component:${component[0]}`, kind: 'relation_component', nodeIds: component })
    } else {
      const node = nodes.find(candidate => candidate.id === component[0])
      const kind = node?.kind || 'concept'
      singleNodeIdsByKind.set(kind, [...(singleNodeIdsByKind.get(kind) || []), component[0]])
    }
  }
  for (const [kind, ids] of Array.from(singleNodeIdsByKind.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    clusters.push({ id: `kind:${kind}`, kind: 'kind_group', nodeIds: [...ids].sort() })
  }
  return clusters
}

export interface StudyMapVisibility {
  visibleInitially: string[]
  availableInMap: string[]
}

/**
 * Progressive-detail contract: `availableInMap` is ALWAYS every node —
 * nothing is ever removed from the reachable universe. `visibleInitially`
 * is a rendering convenience only: everything for a small map, otherwise
 * critical-tier nodes (falling back to all nodes if the Brain declared
 * none critical) — never a fixed numeric cap.
 */
export function computeStudyMapInitialVisibility(nodes: readonly StudyMapNode[]): StudyMapVisibility {
  const availableInMap = nodes.map(node => node.id)
  if (nodes.length <= 20) return { visibleInitially: availableInMap, availableInMap }
  const critical = nodes.filter(node => node.importanceTier === 'critical').map(node => node.id)
  return { visibleInitially: critical.length > 0 ? critical : availableInMap, availableInMap }
}

export interface StudyMapCoverageResult {
  totalMapTargets: number
  representedMapTargets: number
  coveragePercent: number
  missingTargetIds: string[]
  totalRelationIds: number
  representedRelationIds: number
}

/**
 * Deterministic coverage: node denominator is every StudyMapNode id;
 * `representedNodeIds` should always be the full node list by
 * construction (every node the pipeline builds is placed in some
 * cluster) — this exists as a structural integrity check, not an
 * authority gate, since there is no provider in the node-creation path
 * to filter against. Relation coverage reports how many of the Brain's
 * raw relations survived structural cleanup (self/dangling/duplicate
 * filtering) as real academic edges.
 */
export function computeStudyMapCoverage(
  nodes: readonly StudyMapNode[],
  representedNodeIds: readonly string[],
  totalRelationCount: number,
  edges: readonly StudyMapEdge[],
): StudyMapCoverageResult {
  const generic = computeGroundedCoverage(nodes.map(node => node.id), representedNodeIds)
  return {
    totalMapTargets: generic.totalTargets,
    representedMapTargets: generic.representedTargets,
    coveragePercent: generic.coveragePercent,
    missingTargetIds: generic.missingTargetIds,
    totalRelationIds: totalRelationCount,
    representedRelationIds: edges.length,
  }
}

export interface StudyMapGroundedContext {
  fingerprint: string
  builderVersion: string
  nodes: StudyMapNode[]
  edges: StudyMapEdge[]
  clusters: StudyMapVisualCluster[]
  visibility: StudyMapVisibility
  coverage: StudyMapCoverageResult
}

export function buildStudyMapGroundedContext(brain: MaterialBrain): StudyMapGroundedContext {
  const nodes = buildStudyMapNodes(brain)
  const edges = buildStudyMapEdges(brain, nodes)
  const clusters = buildStudyMapVisualClusters(nodes, edges)
  const visibility = computeStudyMapInitialVisibility(nodes)
  const coverage = computeStudyMapCoverage(nodes, nodes.map(node => node.id), (brain.relations || []).length, edges)
  return { fingerprint: brain.scope.fingerprint, builderVersion: brain.meta.builderVersion, nodes, edges, clusters, visibility, coverage }
}

/** Deterministic title from the selected materials — no provider call needed. */
export function deterministicStudyMapTitle(sourceSelection: SourceSelectionSnapshot, materialNamesById: Record<string, string>): string {
  const names = sourceSelection.materialIds.map(id => materialNamesById[id] || id).filter(Boolean)
  return names.length ? `Mapa de estudio: ${names.join(', ')}` : 'Mapa de estudio';
}

// ============================================================
// Node explanation ("explain this node" deep-dive) — a SMALL,
// node-scoped grounded context: the selected unit, its evidence, and
// ONLY the relations/neighbor units it actually participates in. Never
// the whole Brain, never raw material text.
// ============================================================

export interface StudyMapNodeExplanationContext {
  node: StudyMapNode
  edges: StudyMapEdge[]
  neighbors: StudyMapNode[]
}

export function buildStudyMapNodeExplanationContext(
  context: StudyMapGroundedContext,
  unitId: string,
): StudyMapNodeExplanationContext | null {
  const node = context.nodes.find(candidate => candidate.id === unitId)
  if (!node) return null
  const edges = context.edges.filter(edge => edge.sourceUnitId === unitId || edge.targetUnitId === unitId)
  const neighborIds = new Set(edges.map(edge => (edge.sourceUnitId === unitId ? edge.targetUnitId : edge.sourceUnitId)))
  const neighbors = context.nodes.filter(candidate => neighborIds.has(candidate.id))
  return { node, edges, neighbors }
}

/** Compact, id-tagged prompt block for a single node — cheap, focused, never the whole Brain. */
export function renderStudyMapNodeExplanationContext(explanation: StudyMapNodeExplanationContext): string {
  const { node, edges, neighbors } = explanation
  const neighborById = new Map(neighbors.map(neighbor => [neighbor.id, neighbor]))
  const lines: string[] = []
  lines.push(`[UNIT ${node.id}] kind=${node.kind} importance=${node.importanceTier}`)
  lines.push(`LABEL: ${node.label}`)
  lines.push(`CONTENIDO AUTORIZADO: ${node.statement}`)
  if (node.evidenceText) lines.push(`EVIDENCE (${node.derivation || 'desconocida'}): "${node.evidenceText}"`)
  if (node.materialId) lines.push(`FUENTE: material=${node.materialId}${node.pages.length ? ` paginas=${node.pages.join(',')}` : ''}`)
  if (edges.length) {
    lines.push('')
    lines.push('RELACIONES AUTORIZADAS (las ÚNICAS conexiones que puedes mencionar como reales):')
    for (const edge of edges) {
      const otherId = edge.sourceUnitId === node.id ? edge.targetUnitId : edge.sourceUnitId
      const other = neighborById.get(otherId)
      const arrow = edge.sourceUnitId === node.id ? '→' : '←'
      lines.push(`- [${edge.id}] ${arrow} ${edge.type} ${arrow} "${other?.label || otherId}": ${edge.label}`)
    }
  }
  return lines.join('\n')
}
