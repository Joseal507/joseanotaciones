import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'

// ============================================================
// Study Map Enjoyer adapter — Free Mode Study Map's own neutral view of
// the persisted StudyalMaterialEnjoyer. Self-contained (not importing
// lib/materialBrain/studyMapContext.ts or any other tool's adapter):
// same isolation convention already used across every Enjoyer migration
// (Exam, Flashcards, Truquitos, Análisis).
//
// Academic authority is EXACTLY the persisted Enjoyer for this exact
// SourceSelectionSnapshot fingerprint. No Material Brain, no
// KnowledgeUnit-based units, no raw material text, no Vision, no
// regeneration. Node/edge construction is entirely deterministic —
// zero provider calls to build the map itself.
// ============================================================

export const STUDY_MAP_ENJOYER_AUTHORITY_TYPE = 'studyal_material_enjoyer' as const
export const STUDY_MAP_ENJOYER_ADAPTER_VERSION = 'study-map-enjoyer-1.0.0'

export type StudyMapImportanceTier = 'critical' | 'supporting' | 'contextual'

export interface StudyMapEnjoyerSourceSpan { page: number; quote: string }

export interface StudyMapNode {
  id: string
  sourceItemId: string
  kind: string
  importanceTier: StudyMapImportanceTier
  materialId: string | null
  topicId: string | null
  topicTitle: string | null
  pages: number[]
  label: string
  statement: string
  evidenceText: string | null
  sourceOrder: number
}

export interface StudyMapEdge {
  id: string
  relationId: string
  sourceNodeId: string
  targetNodeId: string
  type: string
  label: string
}

export interface StudyMapVisualCluster {
  id: string
  kind: 'relation_component' | 'topic_group'
  nodeIds: string[]
}

export interface StudyMapVisibility {
  visibleInitially: string[]
  availableInMap: string[]
}

export interface StudyMapCoverageResult {
  totalMapTargets: number
  representedMapTargets: number
  coveragePercent: number
  missingTargetIds: string[]
  totalRelationIds: number
  representedRelationIds: number
}

export interface StudyMapEnjoyerContext {
  fingerprint: string
  nodes: StudyMapNode[]
  edges: StudyMapEdge[]
  clusters: StudyMapVisualCluster[]
  visibility: StudyMapVisibility
  coverage: StudyMapCoverageResult
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
}

const NON_ACADEMIC_KINDS = new Set(['metadata', 'decorative', 'divider', 'heading'])

function normalize(value: unknown): string {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(String).map(item => item.trim()).filter(Boolean))] : []
}

function pages(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value.map(Number).filter(page => Number.isInteger(page) && page > 0))].sort((a, b) => a - b)
    : []
}

function spans(value: unknown): StudyMapEnjoyerSourceSpan[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap(raw => {
    const source = raw as Record<string, unknown>
    const page = Number(source.page)
    const quote = String(source.quote || source.text || '').trim()
    const key = `${page}:${quote}`
    if (!Number.isInteger(page) || page < 1 || !quote || seen.has(key)) return []
    seen.add(key)
    return [{ page, quote }]
  })
}

function importanceTier(value: unknown): StudyMapImportanceTier {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric >= 80 ? 'critical' : numeric >= 50 ? 'supporting' : 'contextual'
  const key = normalize(value)
  if (key === 'critical' || key === 'high') return 'critical'
  if (key === 'supporting' || key === 'medium') return 'supporting'
  return 'contextual'
}

function authorityFrom(payload: unknown): EnjoyerAuthority {
  const wrapper = payload as { blueprint?: EnjoyerAuthority } | null
  return (wrapper?.blueprint || payload || {}) as EnjoyerAuthority
}

function assertSelectionMetadata(authority: EnjoyerAuthority, selection: SourceSelectionSnapshot): void {
  if (String(authority.sourceSelectionFingerprint || '') !== selection.fingerprint) throw new Error('SOURCE_SELECTION_MISMATCH')
  const persistedMaterialIds = Array.isArray(authority.materialIds ?? authority.sourceSelection?.materialIds)
    ? strings(authority.materialIds ?? authority.sourceSelection?.materialIds).sort() : []
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

/** Deterministic display-label cleanup — whitespace/bullet normalization only, never changes meaning or authority. */
function cleanDisplayLabel(label: string): string {
  return String(label || '').trim().replace(/\s+/g, ' ').replace(/^[-•*]\s*/, '')
}

/**
 * Builds the deterministic Study Map node/edge/cluster universe from a
 * persisted Enjoyer payload for the EXACT requested source selection.
 * Never builds, never regenerates, never falls back to a different
 * fingerprint — throws SOURCE_SELECTION_MISMATCH on any mismatch, the
 * same restore-only contract already proven for Exam/Flashcards/
 * Truquitos/Análisis. Zero provider calls anywhere in this function.
 *
 * Relation handling: NO taxonomy assumption is made (confirmed absent
 * from every current Enjoyer producer during the Truquitos/Análisis
 * migrations). A relation becomes a real map edge purely on the
 * strength of its explicit fromSourceItemId/toSourceItemId connecting
 * two REAL nodes — its `type` string is carried through for display
 * only. When no relations are present, visual clustering falls back to
 * topicId grouping — an honest deterministic fallback, never a
 * fabricated academic claim.
 */
export function buildStudyMapEnjoyerContext(payload: unknown, selection: SourceSelectionSnapshot): StudyMapEnjoyerContext {
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
  const nodes: StudyMapNode[] = []
  for (const [index, raw] of rawItems.entries()) {
    const item = raw as Record<string, unknown>
    const sourceItemId = String(item.id || '').trim()
    const label = String(item.name || item.label || item.title || '').trim()
    const content = String(item.summary || item.content || item.statement || '').trim()
    const kind = String(item.kind || 'academic_item').trim()
    if (!sourceItemId || seenIds.has(sourceItemId) || !label || !content) continue
    if (NON_ACADEMIC_KINDS.has(normalize(kind))) continue
    const exactIdentity = `${normalize(label)}::${normalize(content)}`
    if (seenExactContent.has(exactIdentity)) continue
    const materialIds = strings(item.materialIds)
    const materialId = String(item.materialId || materialIds[0] || selection.materialIds[0] || '')
    const itemSpans = spans(item.sourceSpans)
    const itemPages = pages(item.pages).length ? pages(item.pages) : pages(itemSpans.map(span => span.page))
    const authorized = selectedPages.get(materialId)
    if (!authorized || itemPages.some(page => !authorized.has(page))) throw new Error('SOURCE_SELECTION_MISMATCH')
    const topicIds = strings(item.topicIds)
    const topicId = String(item.topicId || topicIds[0] || '') || null
    seenIds.add(sourceItemId)
    seenExactContent.add(exactIdentity)
    nodes.push({
      id: `map_node:${sourceItemId}`, sourceItemId, kind, importanceTier: importanceTier(item.importance ?? item.importanceTier),
      materialId: materialId || null, topicId, topicTitle: topicId ? topicTitles.get(topicId) || null : null,
      pages: itemPages, label: cleanDisplayLabel(label), statement: content,
      evidenceText: itemSpans[0]?.quote || null, sourceOrder: Number(item.globalOrder ?? item.firstAppearanceOrder ?? index),
    })
  }
  nodes.sort((a, b) => a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id))

  const sourceIds = new Set(nodes.map(node => node.sourceItemId))
  const nodeBySourceItemId = new Map(nodes.map(node => [node.sourceItemId, node]))
  const rawRelations = [
    ...(Array.isArray(authority.relations) ? authority.relations : []),
    ...rawItems.flatMap(raw => Array.isArray((raw as any)?.relations) ? (raw as any).relations : []),
  ]
  const edges: StudyMapEdge[] = []
  const seenEdges = new Set<string>()
  const totalRawRelations = rawRelations.length
  for (const [index, raw] of rawRelations.entries()) {
    const relation = raw as Record<string, unknown>
    const from = String(relation.fromSourceItemId || relation.fromId || relation.sourceId || '').trim()
    const to = String(relation.toSourceItemId || relation.toId || relation.targetId || '').trim()
    if (!sourceIds.has(from) || !sourceIds.has(to) || from === to) continue // dangling/self relations dropped — never fabricated
    const type = String(relation.type || relation.kind || 'related').trim()
    const id = String(relation.id || `relation_${index}`)
    const key = `${from}::${type}::${to}`
    if (seenEdges.has(key)) continue
    seenEdges.add(key)
    edges.push({
      id, relationId: id, sourceNodeId: nodeBySourceItemId.get(from)!.id, targetNodeId: nodeBySourceItemId.get(to)!.id,
      type, label: `${nodeBySourceItemId.get(from)!.label} ${type} ${nodeBySourceItemId.get(to)!.label}`,
    })
  }

  const clusters = buildVisualClusters(nodes, edges)
  const visibility = computeInitialVisibility(nodes)
  const coverage: StudyMapCoverageResult = {
    totalMapTargets: nodes.length, representedMapTargets: nodes.length, coveragePercent: nodes.length ? 100 : 0,
    missingTargetIds: [], totalRelationIds: totalRawRelations, representedRelationIds: edges.length,
  }
  return { fingerprint: selection.fingerprint, nodes, edges, clusters, visibility, coverage }
}

/**
 * Visual grouping only — NEVER an academic claim. Preferred authority
 * order: (1) connected components of real relation edges, when present
 * — semantically coherent; (2) shared topicId for the leftover
 * unconnected nodes — an honest deterministic fallback, since the
 * Enjoyer relation taxonomy is not guaranteed to exist at all; (3) kind
 * for whatever remains topic-less. None of these invent a relationship
 * a node doesn't have.
 */
function buildVisualClusters(nodes: readonly StudyMapNode[], edges: readonly StudyMapEdge[]): StudyMapVisualCluster[] {
  const parent = new Map<string, string>()
  for (const node of nodes) parent.set(node.id, node.id)
  function find(id: string): string {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root) as string
    let cursor = id
    while (parent.get(cursor) !== root) { const next = parent.get(cursor) as string; parent.set(cursor, root); cursor = next }
    return root
  }
  function union(a: string, b: string): void { const rootA = find(a); const rootB = find(b); if (rootA !== rootB) parent.set(rootA, rootB) }
  for (const edge of edges) union(edge.sourceNodeId, edge.targetNodeId)

  const groups = new Map<string, string[]>()
  for (const node of nodes) { const root = find(node.id); groups.set(root, [...(groups.get(root) || []), node.id]) }

  const clusters: StudyMapVisualCluster[] = []
  const leftoverByTopic = new Map<string, string[]>()
  for (const [root, memberIds] of groups) {
    if (memberIds.length > 1) {
      clusters.push({ id: `component:${root}`, kind: 'relation_component', nodeIds: [...memberIds].sort() })
    } else {
      const node = nodes.find(candidate => candidate.id === memberIds[0])!
      const key = node.topicId || `kind:${node.kind}`
      leftoverByTopic.set(key, [...(leftoverByTopic.get(key) || []), node.id])
    }
  }
  for (const [key, ids] of Array.from(leftoverByTopic.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    clusters.push({ id: `topic:${key}`, kind: 'topic_group', nodeIds: [...ids].sort() })
  }
  return clusters
}

/** Progressive-detail contract: `availableInMap` is always every node; `visibleInitially` is a rendering convenience only. */
function computeInitialVisibility(nodes: readonly StudyMapNode[]): StudyMapVisibility {
  const availableInMap = nodes.map(node => node.id)
  if (nodes.length <= 20) return { visibleInitially: availableInMap, availableInMap }
  const critical = nodes.filter(node => node.importanceTier === 'critical').map(node => node.id)
  return { visibleInitially: critical.length > 0 ? critical : availableInMap, availableInMap }
}

/** Deterministic title from the selected materials — no provider call needed. */
export function deterministicStudyMapTitle(sourceSelection: SourceSelectionSnapshot, materialNamesById: Record<string, string>): string {
  const names = sourceSelection.materialIds.map(id => materialNamesById[id] || id).filter(Boolean)
  return names.length ? `Mapa de estudio: ${names.join(', ')}` : 'Mapa de estudio'
}

// ============================================================
// Node explanation ("explain this node" deep-dive) — a SMALL,
// node-scoped grounded context: the selected node, its evidence, and
// ONLY the relations/neighbor nodes it actually participates in. Never
// the whole Enjoyer universe, never raw material text.
// ============================================================

export interface StudyMapNodeExplanationContext {
  nodes: StudyMapNode[]
  edges: StudyMapEdge[]
  neighbors: StudyMapNode[]
}

/**
 * STUDYMAP_LIVE_UX_HARDENING unification: ONE explanation-context builder
 * for every Study Map node type — a leaf sends exactly one real Enjoyer
 * node id; a branch/category sends every real Enjoyer node id among its
 * descendant leaves (computed client-side from the already-built tree,
 * never re-derived server-side from anything but real node ids). Root
 * never calls this (see ALAIStudyMap.tsx — root explanation stays fully
 * deterministic, 0 provider calls). Grounding is identical in kind for
 * 1 node or many: only real Enjoyer nodes/edges, never invented.
 */
export function buildStudyMapNodeExplanationContext(
  context: StudyMapEnjoyerContext, nodeIds: string[],
): StudyMapNodeExplanationContext | null {
  const idSet = new Set(nodeIds)
  const nodes = context.nodes.filter(candidate => idSet.has(candidate.id))
  if (!nodes.length) return null
  const edges = context.edges.filter(edge => idSet.has(edge.sourceNodeId) || idSet.has(edge.targetNodeId))
  const neighborIds = new Set<string>()
  for (const edge of edges) {
    if (!idSet.has(edge.sourceNodeId)) neighborIds.add(edge.sourceNodeId)
    if (!idSet.has(edge.targetNodeId)) neighborIds.add(edge.targetNodeId)
  }
  const neighbors = context.nodes.filter(candidate => neighborIds.has(candidate.id))
  return { nodes, edges, neighbors }
}

/** Compact, id-tagged prompt block for one or several nodes — cheap, focused, never the whole Enjoyer universe. */
export function renderStudyMapNodeExplanationContext(explanation: StudyMapNodeExplanationContext): string {
  const { nodes, edges, neighbors } = explanation
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const neighborById = new Map(neighbors.map(n => [n.id, n]))
  const labelFor = (id: string) => nodeById.get(id)?.label || neighborById.get(id)?.label || id
  const lines: string[] = []
  for (const node of nodes) {
    lines.push(`[NODE ${node.id}] kind=${node.kind} importance=${node.importanceTier}`)
    lines.push(`LABEL: ${node.label}`)
    lines.push(`CONTENIDO AUTORIZADO: ${node.statement}`)
    if (node.evidenceText) lines.push(`EVIDENCE: "${node.evidenceText}"`)
    if (node.materialId) lines.push(`FUENTE: material=${node.materialId}${node.pages.length ? ` paginas=${node.pages.join(',')}` : ''}`)
    lines.push('')
  }
  if (edges.length) {
    lines.push('RELACIONES AUTORIZADAS (las ÚNICAS conexiones que puedes mencionar como reales):')
    for (const edge of edges) {
      lines.push(`- [${edge.id}] "${labelFor(edge.sourceNodeId)}" ${edge.type} → "${labelFor(edge.targetNodeId)}": ${edge.label}`)
    }
  }
  return lines.join('\n')
}
