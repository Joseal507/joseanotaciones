import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'

// ============================================================
// Análisis Enjoyer adapter — Free Mode Análisis' own neutral view of
// the persisted StudyalMaterialEnjoyer. Self-contained (not importing
// lib/materialBrain/analysisContext.ts, examEnjoyerContext.ts, or any
// other tool's adapter): same isolation convention already used across
// every Enjoyer migration (Exam, Flashcards, Truquitos) — each tool's
// adapter is small and independent so tools evolve without coupling to
// each other's schema decisions.
//
// Academic authority is EXACTLY the persisted Enjoyer for this exact
// SourceSelectionSnapshot fingerprint. No Material Brain, no
// KnowledgeUnit, no raw material text, no Vision, no regeneration.
// ============================================================

export const ANALYSIS_ENJOYER_AUTHORITY_TYPE = 'studyal_material_enjoyer' as const
export const ANALYSIS_ENJOYER_ADAPTER_VERSION = 'analysis-enjoyer-1.0.0'

export type AnalysisImportanceTier = 'critical' | 'supporting' | 'contextual'

export interface AnalysisEnjoyerSourceSpan { page: number; quote: string }

export interface AnalysisEnjoyerTarget {
  id: string
  sourceItemId: string
  relationIds: string[]
  kind: string
  importance: number
  importanceTier: AnalysisImportanceTier
  materialId: string | null
  topicId: string | null
  topicTitle: string | null
  pages: number[]
  label: string
  content: string
  evidence: AnalysisEnjoyerSourceSpan[]
  sourceOrder: number
}

export interface AnalysisEnjoyerRelation {
  id: string
  type: string
  fromSourceItemId: string
  toSourceItemId: string
}

export interface AnalysisEnjoyerCluster {
  id: string
  targetIds: string[]
  primaryTargetId: string
  relationIds: string[]
  kindsPresent: string[]
  topicId: string | null
  topicTitle: string | null
}

export interface AnalysisEnjoyerContext {
  fingerprint: string
  targets: AnalysisEnjoyerTarget[]
  relations: AnalysisEnjoyerRelation[]
  clusters: AnalysisEnjoyerCluster[]
  topics: Array<{ id: string; title: string; order: number }>
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
const TIER_RANK: Record<AnalysisImportanceTier, number> = { critical: 0, supporting: 1, contextual: 2 }

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

function spans(value: unknown): AnalysisEnjoyerSourceSpan[] {
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

/** Same numeric-importance bucketing used across every Enjoyer tool adapter (Exam/Truquitos). */
function importanceTier(value: unknown): AnalysisImportanceTier {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric >= 80 ? 'critical' : numeric >= 50 ? 'supporting' : 'contextual'
  const key = normalize(value)
  if (key === 'critical' || key === 'high') return 'critical'
  if (key === 'supporting' || key === 'medium') return 'supporting'
  return 'contextual'
}

function importanceNumber(value: unknown): number {
  if (Number.isFinite(Number(value))) return Math.max(0, Math.min(100, Number(value)))
  const key = normalize(value)
  if (key === 'critical' || key === 'high') return 90
  if (key === 'supporting' || key === 'medium') return 60
  return 35
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

/**
 * Builds the deterministic Análisis target set from a persisted Enjoyer
 * payload for the EXACT requested source selection. Every surviving
 * source item becomes ONE target (unlike Truquitos, which filters to
 * strategy-eligible items only — Análisis narrates and counts coverage
 * over the whole material, not a pedagogical-trick subset). Never
 * builds, never regenerates, never falls back to a different
 * fingerprint — throws SOURCE_SELECTION_MISMATCH on any mismatch, the
 * same restore-only contract already proven for Exam/Flashcards/Truquitos.
 *
 * Relation handling: NO taxonomy assumption is made (the Truquitos
 * migration confirmed no current Enjoyer producer guarantees a specific
 * relation-type vocabulary). A relation is used for clustering purely
 * on the strength of its explicit fromSourceItemId/toSourceItemId
 * connecting two REAL targets — its `type` string is carried through
 * for display only, never required to match a known taxonomy. Nothing
 * is inferred or fabricated when relations are absent.
 */
export function buildAnalysisEnjoyerContext(payload: unknown, selection: SourceSelectionSnapshot): AnalysisEnjoyerContext {
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
  const targets: AnalysisEnjoyerTarget[] = []
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
    targets.push({
      id: `analysis_target:${sourceItemId}`, sourceItemId, relationIds: [],
      kind, importance: importanceNumber(item.importance ?? item.importanceTier), importanceTier: importanceTier(item.importance ?? item.importanceTier),
      materialId: materialId || null, topicId, topicTitle: topicId ? topicTitles.get(topicId) || null : null,
      pages: itemPages, label, content, evidence: itemSpans,
      sourceOrder: Number(item.globalOrder ?? item.firstAppearanceOrder ?? index),
    })
  }
  targets.sort((a, b) => a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id))

  const sourceIds = new Set(targets.map(target => target.sourceItemId))
  const targetBySourceItemId = new Map(targets.map(target => [target.sourceItemId, target]))
  const rawRelations = [
    ...(Array.isArray(authority.relations) ? authority.relations : []),
    ...rawItems.flatMap(raw => Array.isArray((raw as any)?.relations) ? (raw as any).relations : []),
  ]
  const relations: AnalysisEnjoyerRelation[] = []
  const seenRelations = new Set<string>()
  for (const [index, raw] of rawRelations.entries()) {
    const relation = raw as Record<string, unknown>
    const from = String(relation.fromSourceItemId || relation.fromId || relation.sourceId || '').trim()
    const to = String(relation.toSourceItemId || relation.toId || relation.targetId || '').trim()
    if (!sourceIds.has(from) || !sourceIds.has(to) || from === to) continue
    const type = String(relation.type || relation.kind || 'related').trim()
    const key = `${from}:${type}:${to}`
    if (seenRelations.has(key)) continue
    seenRelations.add(key)
    const id = String(relation.id || `relation_${index}`)
    relations.push({ id, type, fromSourceItemId: from, toSourceItemId: to })
    targetBySourceItemId.get(from)?.relationIds.push(id)
    targetBySourceItemId.get(to)?.relationIds.push(id)
  }

  const clusters = buildClusters(targets, relations)
  return { fingerprint: selection.fingerprint, targets, relations, clusters, topics }
}

/**
 * Connected-components clustering with TWO honest signals, both always
 * applied (never "try A, else B" — they compose losslessly via union-
 * find): (1) explicit relations connecting two real targets, and (2) a
 * shared topicId. When relations are absent (the common case — see the
 * adapter-level note on relation-taxonomy availability), this degrades
 * cleanly to one cluster per topic, which is an honest deterministic
 * grouping, never a fabricated one. Source order is used only to pick a
 * stable primary target and cluster ordering, never to group.
 */
function buildClusters(targets: AnalysisEnjoyerTarget[], relations: AnalysisEnjoyerRelation[]): AnalysisEnjoyerCluster[] {
  const targetById = new Map(targets.map(target => [target.id, target]))
  const sourceItemToTargetId = new Map(targets.map(target => [target.sourceItemId, target.id]))
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

  for (const relation of relations) {
    const fromId = sourceItemToTargetId.get(relation.fromSourceItemId)
    const toId = sourceItemToTargetId.get(relation.toSourceItemId)
    if (fromId && toId) union(fromId, toId)
  }
  const byTopic = new Map<string, string[]>()
  for (const target of targets) {
    if (!target.topicId) continue
    byTopic.set(target.topicId, [...(byTopic.get(target.topicId) || []), target.id])
  }
  for (const ids of byTopic.values()) {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i])
  }

  const groups = new Map<string, string[]>()
  for (const target of targets) {
    const root = find(target.id)
    groups.set(root, [...(groups.get(root) || []), target.id])
  }

  const clusters: AnalysisEnjoyerCluster[] = []
  for (const [root, memberIds] of groups) {
    const sortedIds = [...memberIds].sort((a, b) => targetById.get(a)!.sourceOrder - targetById.get(b)!.sourceOrder)
    const idSet = new Set(sortedIds)
    const relationIds = relations
      .filter(relation => idSet.has(sourceItemToTargetId.get(relation.fromSourceItemId) || '') && idSet.has(sourceItemToTargetId.get(relation.toSourceItemId) || ''))
      .map(relation => relation.id)
    const primaryTargetId = [...sortedIds].sort((a, b) => {
      const tierDiff = TIER_RANK[targetById.get(a)!.importanceTier] - TIER_RANK[targetById.get(b)!.importanceTier]
      return tierDiff !== 0 ? tierDiff : targetById.get(a)!.sourceOrder - targetById.get(b)!.sourceOrder
    })[0]
    const primary = targetById.get(primaryTargetId)!
    clusters.push({
      id: `cluster:${root}`, targetIds: sortedIds, primaryTargetId, relationIds,
      kindsPresent: Array.from(new Set(sortedIds.map(id => targetById.get(id)!.kind))),
      topicId: primary.topicId, topicTitle: primary.topicTitle,
    })
  }
  clusters.sort((a, b) => targetById.get(a.primaryTargetId)!.sourceOrder - targetById.get(b.primaryTargetId)!.sourceOrder)
  return clusters
}

/** Structured, cluster-organized prompt block — every fact tagged with its ANALYSIS_TARGET id. */
export function renderAnalysisEnjoyerContext(context: AnalysisEnjoyerContext, maxChars = 90000): string {
  const targetById = new Map(context.targets.map(target => [target.id, target]))
  const relationById = new Map(context.relations.map(relation => [relation.id, relation]))
  const lines: string[] = []
  for (const cluster of context.clusters) {
    lines.push(`[CLUSTER ${cluster.id}] kinds=${cluster.kindsPresent.join(',')}${cluster.topicTitle ? ` topic=${cluster.topicTitle}` : ''}`)
    for (const targetId of cluster.targetIds) {
      const target = targetById.get(targetId)
      if (!target) continue
      lines.push(`  [ANALYSIS_TARGET ${target.id}]`)
      lines.push(`  KIND: ${target.kind}`)
      lines.push(`  IMPORTANCE: ${target.importanceTier}`)
      lines.push(`  LABEL: ${target.label}`)
      lines.push(`  CONTENIDO AUTORIZADO: ${target.content}`)
      if (target.pages.length) lines.push(`  PAGES: material=${target.materialId || '?'} paginas=${target.pages.join(',')}`)
      const evidenceLines = target.evidence.filter(row => row.quote)
      if (evidenceLines.length) {
        lines.push('  EVIDENCE:')
        for (const row of evidenceLines) lines.push(`    - "${row.quote}"`)
      }
      if (target.relationIds.length) lines.push(`  RELATION_IDS: ${target.relationIds.join(', ')}`)
    }
    if (cluster.relationIds.length) {
      lines.push('  RELATIONS:')
      for (const relationId of cluster.relationIds) {
        const relation = relationById.get(relationId)
        if (relation) lines.push(`    - [${relation.id}] ${relation.fromSourceItemId} --${relation.type}--> ${relation.toSourceItemId}`)
      }
    }
    lines.push('')
  }
  const rendered = lines.join('\n')
  if (rendered.length <= maxChars) return rendered
  return rendered.slice(0, maxChars) + '\n\n[Contexto recortado para el análisis]'
}

export interface AnalysisEnjoyerCoverageResult {
  totalAnalysisTargets: number
  representedAnalysisTargets: number
  coveragePercent: number
  missingTargetIds: string[]
}

/** Deterministic coverage over the FULL target set — provider never decides the denominator. */
export function computeAnalysisCoverage(
  targets: readonly AnalysisEnjoyerTarget[],
  representedTargetIds: readonly string[],
): AnalysisEnjoyerCoverageResult {
  const total = targets.map(target => target.id)
  const represented = new Set(representedTargetIds)
  const missingTargetIds = total.filter(id => !represented.has(id))
  const representedCount = total.length - missingTargetIds.length
  return {
    totalAnalysisTargets: total.length,
    representedAnalysisTargets: representedCount,
    coveragePercent: total.length === 0 ? 0 : Math.round((representedCount / total.length) * 10000) / 100,
    missingTargetIds,
  }
}

export type AnalysisExamProbability = 'alta' | 'media' | 'baja'

/**
 * Deterministic exam-likelihood signal — ported 1:1 from the Material
 * Brain version's rule (lib/materialBrain/analysisContext.ts):
 *  - "alta": critical tier, OR supporting tier with >=2 relations.
 *  - "media": supporting tier (not already alta), OR contextual tier with >=2 relations.
 *  - "baja": everything else.
 */
export function analysisExamProbability(target: AnalysisEnjoyerTarget): AnalysisExamProbability {
  if (target.importanceTier === 'critical') return 'alta'
  if (target.importanceTier === 'supporting') return target.relationIds.length >= 2 ? 'alta' : 'media'
  return target.relationIds.length >= 2 ? 'media' : 'baja'
}

export interface DeterministicCoberturaItem { elemento: string; por_que_importa: string; targetIds: string[] }
export interface DeterministicParaExamenItem { punto: string; por_que: string; targetIds: string[] }
export interface DeterministicProbabilidadItem { concepto: string; probabilidad: AnalysisExamProbability; razon: string; targetId: string }

/** cobertura_material — every non-contextual target, derived directly from the Enjoyer, no provider call. */
export function deterministicCoberturaMaterial(targets: readonly AnalysisEnjoyerTarget[]): DeterministicCoberturaItem[] {
  return targets
    .filter(target => target.importanceTier !== 'contextual')
    .map(target => ({ elemento: target.label, por_que_importa: target.content, targetIds: [target.id] }))
}

/** para_examen — critical targets, plus well-connected supporting targets. */
export function deterministicParaExamen(targets: readonly AnalysisEnjoyerTarget[]): DeterministicParaExamenItem[] {
  return targets
    .filter(target => analysisExamProbability(target) === 'alta')
    .map(target => ({ punto: target.label, por_que: target.content, targetIds: [target.id] }))
}

/** probabilidad_examen — one deterministic row per target. */
export function deterministicProbabilidadExamen(targets: readonly AnalysisEnjoyerTarget[]): DeterministicProbabilidadItem[] {
  return targets.map(target => {
    const probabilidad = analysisExamProbability(target)
    const razon = probabilidad === 'alta'
      ? (target.importanceTier === 'critical' ? 'Concepto marcado como crítico en el material.' : 'Concepto de apoyo con múltiples relaciones — bien conectado al resto del material.')
      : probabilidad === 'media'
        ? 'Concepto de apoyo o contextual con conexiones moderadas.'
        : 'Concepto contextual con poca conexión al resto del material.'
    return { concepto: target.label, probabilidad, razon, targetId: target.id }
  })
}

/** ya_puedes_explicar — critical + well-connected supporting target labels, capped for UI readability. */
export function deterministicYaPuedesExplicar(targets: readonly AnalysisEnjoyerTarget[], limit = 12): string[] {
  return targets
    .filter(target => analysisExamProbability(target) !== 'baja')
    .slice(0, limit)
    .map(target => target.label)
}
