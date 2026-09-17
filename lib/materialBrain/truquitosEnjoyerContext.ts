import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'
import { detectLanguage } from '../detectLanguage'

export const TRUQUITOS_ENJOYER_AUTHORITY_TYPE = 'studyal_material_enjoyer' as const
export const TRUQUITOS_ENJOYER_ADAPTER_VERSION = 'truquitos-enjoyer-1.0.0'

// ============================================================
// Truquitos Enjoyer adapter — Free Mode Truquitos' own neutral view of
// the persisted StudyalMaterialEnjoyer. Self-contained (not importing
// lib/materialBrain/examEnjoyerContext.ts or the flashcards adapter):
// same isolation convention already used across the Enjoyer migrations
// (Exam, Flashcards) — each tool's adapter is small and independent so
// tools evolve without coupling to each other's schema decisions.
//
// Academic authority is EXACTLY the persisted Enjoyer for this exact
// SourceSelectionSnapshot fingerprint. No Material Brain, no
// KnowledgeUnit, no raw material text, no Vision, no regeneration.
// ============================================================

export type TruquitoStrategy =
  | 'mnemonic' | 'contrast' | 'pattern' | 'step_memory'
  | 'formula_memory' | 'error_warning' | 'association' | 'exam_cue'

export type TruquitoImportanceTier = 'critical' | 'supporting' | 'contextual'

export interface TruquitoEnjoyerSourceSpan { page: number; quote: string }

export interface TruquitoEnjoyerTarget {
  id: string
  sourceItemIds: string[]
  relationIds: string[]
  kind: string
  importanceTier: TruquitoImportanceTier
  materialId: string | null
  topicId: string | null
  topicTitle: string | null
  pages: number[]
  label: string
  content: string
  evidence: TruquitoEnjoyerSourceSpan[]
  sourceOrder: number
  canonicalSources?: { materialId: string; pages: number[]; sourceItemId: string; content: string }[]
  strategyOpportunities: TruquitoStrategy[]
}

export interface TruquitoEnjoyerRelation {
  id: string
  type: string
  fromSourceItemId: string
  toSourceItemId: string
}

export interface TruquitosEnjoyerContext {
  fingerprint: string
  language: 'es' | 'en'
  targets: TruquitoEnjoyerTarget[]
  relations: TruquitoEnjoyerRelation[]
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

/**
 * The ONLY relation types this adapter will ever treat as grounding a
 * relation-based strategy. NOT inferred, NOT synonym-matched — an exact
 * (normalized) string match against the same taxonomy Material Brain's
 * RelationType used. Verified against every current Enjoyer producer
 * (app/api/adaptive/blueprint/route.ts's block-generation prompt): the
 * schema exposes an empty `"relations": []` placeholder with NO prompt
 * instruction or example teaching the model this taxonomy, so a real
 * persisted Enjoyer record may legitimately have zero relations, or
 * relations with unrelated free-text `type` values. This adapter never
 * fabricates a relation or infers one from proximity/order — a target
 * with no matching relation simply keeps its unit-level strategies only.
 */
const RELATION_OPPORTUNITIES: Partial<Record<string, { strategies: TruquitoStrategy[]; kind: string }>> = {
  contrasts_with: { strategies: ['contrast', 'error_warning'], kind: 'contrast_pair' },
  causes: { strategies: ['pattern'], kind: 'causal_pair' },
  precedes: { strategies: ['pattern'], kind: 'causal_pair' },
  applies_formula: { strategies: ['formula_memory'], kind: 'formula_application' },
  example_of: { strategies: ['association'], kind: 'example_pair' },
}

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

function spans(value: unknown): TruquitoEnjoyerSourceSpan[] {
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

/**
 * Deterministic importance bucketing — Enjoyer targets carry a numeric
 * 0-100 importance score (see examEnjoyerContext.ts's own `importance()`
 * mapping), not Material Brain's tier enum directly. Same thresholds
 * used app-wide for "critical"-equivalent classification.
 */
function importanceTier(value: unknown): TruquitoImportanceTier {
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
 * Which pedagogical strategies a single Enjoyer target's OWN structure
 * legitimately supports — ported 1:1 from the Material Brain rule
 * (lib/materialBrain/truquitosContext.ts), except step_memory: Enjoyer
 * source items do not carry an explicit step list (unlike Brain's
 * `unit.steps`), so this adapter cannot verify ">=2 real steps" and
 * instead grants step_memory to any `process`-kind target — a graceful
 * widening the honest lack of that field forces, not a fabrication of
 * new facts.
 */
function unitOpportunities(kind: string, tier: TruquitoImportanceTier): TruquitoStrategy[] {
  const normalizedKind = normalize(kind)
  const strategies: TruquitoStrategy[] = []
  if (normalizedKind === 'terminology' || normalizedKind === 'definition') strategies.push('mnemonic', 'association')
  if (normalizedKind === 'formula') strategies.push('formula_memory')
  if (normalizedKind === 'process') strategies.push('step_memory')
  if (tier === 'critical') strategies.push('exam_cue')
  if (!strategies.some(strategy => strategy !== 'exam_cue')) strategies.unshift('mnemonic', 'association')
  return strategies
}

/**
 * Builds the deterministic Truquitos-eligible target set from a
 * persisted Enjoyer payload for the EXACT requested source selection.
 * Never builds, never regenerates, never falls back to a different
 * fingerprint — throws SOURCE_SELECTION_MISMATCH on any mismatch, the
 * same restore-only contract already proven for Exam/Flashcards.
 */
export function buildTruquitosEnjoyerContext(payload: unknown, selection: SourceSelectionSnapshot): TruquitosEnjoyerContext {
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

  interface SourceItem {
    sourceItemId: string; kind: string; label: string; content: string
    importance: number; tier: TruquitoImportanceTier; materialId: string
    topicId: string | null; pages: number[]; spans: TruquitoEnjoyerSourceSpan[]; sourceOrder: number
  }

  const seenIds = new Set<string>()
  const seenExactContent = new Set<string>()
  const items: SourceItem[] = []
  for (const [index, raw] of rawItems.entries()) {
    const item = raw as Record<string, unknown>
    const sourceItemId = String(item.id || '').trim()
    const label = String(item.name || item.label || item.title || '').trim()
    const content = String(item.summary || item.content || item.statement || '')
    const kind = String(item.kind || 'academic_item').trim()
    if (!sourceItemId || seenIds.has(sourceItemId) || !label || !content.trim()) continue
    if (NON_ACADEMIC_KINDS.has(normalize(kind))) continue
    const exactIdentity = `${sourceItemId}`
    if (seenExactContent.has(exactIdentity)) continue
    const materialIds = strings(item.materialIds)
    const materialId = String(item.materialId || materialIds[0] || selection.materialIds[0] || '')
    const itemSpans = spans(item.sourceSpans)
    const itemPages = pages(item.pages).length ? pages(item.pages) : pages(itemSpans.map(span => span.page))
    const authorized = selectedPages.get(materialId)
    if (!authorized || [...itemPages, ...itemSpans.map(span => span.page)].some(page => !authorized.has(page))) throw new Error('SOURCE_SELECTION_MISMATCH')
    const topicIds = strings(item.topicIds)
    const topicId = String(item.topicId || topicIds[0] || '') || null
    seenIds.add(sourceItemId)
    seenExactContent.add(exactIdentity)
    items.push({
      sourceItemId, kind, label, content,
      importance: importanceNumber(item.importance ?? item.importanceTier), tier: importanceTier(item.importance ?? item.importanceTier),
      materialId, topicId, pages: itemPages, spans: itemSpans,
      sourceOrder: Number(item.globalOrder ?? item.firstAppearanceOrder ?? index),
    })
  }
  items.sort((a, b) => a.sourceOrder - b.sourceOrder || a.sourceItemId.localeCompare(b.sourceItemId))

  const sourceIds = new Set(items.map(item => item.sourceItemId))
  const rawRelations = [
    ...(Array.isArray(authority.relations) ? authority.relations : []),
    ...rawItems.flatMap(raw => Array.isArray((raw as any)?.relations) ? (raw as any).relations : []),
  ]
  const relations: TruquitoEnjoyerRelation[] = []
  const seenRelations = new Set<string>()
  for (const [index, raw] of rawRelations.entries()) {
    const relation = raw as Record<string, unknown>
    const from = String(relation.fromSourceItemId || relation.fromId || relation.sourceId || '').trim()
    const to = String(relation.toSourceItemId || relation.toId || relation.targetId || '').trim()
    if (!sourceIds.has(from) || !sourceIds.has(to) || from === to) continue
    // Light normalization ONLY (lowercase/trim) — the general `normalize()`
    // strips underscores, which would corrupt exact-match taxonomy keys
    // like "contrasts_with" into "contrasts with".
    const type = String(relation.type || relation.kind || '').trim().toLowerCase()
    if (!type || !RELATION_OPPORTUNITIES[type]) continue // only exact-known, understood relation types are used
    const key = `${from}:${type}:${to}`
    if (seenRelations.has(key)) continue
    seenRelations.add(key)
    relations.push({ id: String(relation.id || `relation_${index}`), type, fromSourceItemId: from, toSourceItemId: to })
  }

  const itemById = new Map(items.map(item => [item.sourceItemId, item]))
  const targets: TruquitoEnjoyerTarget[] = []

  for (const item of items) {
    const strategies = unitOpportunities(item.kind, item.tier)
    if (!strategies.length) continue
    targets.push({
      id: `unit:${item.sourceItemId}`, sourceItemIds: [item.sourceItemId], relationIds: [],
      kind: item.kind, importanceTier: item.tier, materialId: item.materialId || null,
      topicId: item.topicId, topicTitle: item.topicId ? topicTitles.get(item.topicId) || null : null,
      pages: item.pages, label: item.label, content: item.content, evidence: item.spans,
      sourceOrder: item.sourceOrder, strategyOpportunities: strategies,
      canonicalSources: [{ materialId: item.materialId, pages: item.pages, sourceItemId: item.sourceItemId, content: item.content }],
    })
  }

  for (const relation of relations) {
    const opportunity = RELATION_OPPORTUNITIES[relation.type]
    if (!opportunity) continue
    const fromItem = itemById.get(relation.fromSourceItemId)
    const toItem = itemById.get(relation.toSourceItemId)
    if (!fromItem || !toItem) continue
    const tier: TruquitoImportanceTier = fromItem.tier === 'critical' || toItem.tier === 'critical' ? 'critical' : 'supporting'
    targets.push({
      id: `relation:${relation.id}`, sourceItemIds: [fromItem.sourceItemId, toItem.sourceItemId], relationIds: [relation.id],
      kind: opportunity.kind, importanceTier: tier, materialId: fromItem.materialId || null,
      topicId: fromItem.topicId, topicTitle: fromItem.topicId ? topicTitles.get(fromItem.topicId) || null : null,
      pages: [...new Set([...fromItem.pages, ...toItem.pages])].sort((a, b) => a - b),
      label: `${fromItem.label} ↔ ${toItem.label}`, content: `${fromItem.content} ${toItem.content}`.trim(),
      evidence: [...fromItem.spans, ...toItem.spans], sourceOrder: Math.min(fromItem.sourceOrder, toItem.sourceOrder),
      strategyOpportunities: opportunity.strategies,
      canonicalSources: [fromItem, toItem].map(item => ({ materialId: item.materialId, pages: item.pages, sourceItemId: item.sourceItemId, content: item.content })),
    })
  }

  const authorityLang = typeof (authority as any).language === 'string'
    ? (authority as any).language
    : typeof (authority as any).lang === 'string'
      ? (authority as any).lang
      : null
  const sampleText = items.map(item => `${item.label} ${item.content}`).slice(0, 15).join(' ')
  const language: 'es' | 'en' = authorityLang && String(authorityLang).toLowerCase().startsWith('en')
    ? 'en'
    : authorityLang && String(authorityLang).toLowerCase().startsWith('es')
      ? 'es'
      : detectLanguage(sampleText, 'es')

  return { fingerprint: selection.fingerprint, language, targets, relations }
}

/**
 * Batch size for a SINGLE generation call — same product decision as
 * the Material Brain version (a real token-budget constraint, not a
 * quantity decision). Diversity-first: one target per importance tier
 * ordering before repeating, critical tier prioritized.
 */
export function selectTruquitoTargetsForBatch(targets: readonly TruquitoEnjoyerTarget[], maxBatch = 24): TruquitoEnjoyerTarget[] {
  const tierRank = (tier: TruquitoImportanceTier) => (tier === 'critical' ? 0 : tier === 'supporting' ? 1 : 2)
  const sorted = [...targets].sort((a, b) => {
    const diff = tierRank(a.importanceTier) - tierRank(b.importanceTier)
    return diff !== 0 ? diff : a.id.localeCompare(b.id)
  })
  return sorted.slice(0, maxBatch)
}

/** Structured, id-tagged prompt block — cheap, only the eligible batch, never the whole Enjoyer universe. */
export function renderTruquitosEnjoyerContext(targets: readonly TruquitoEnjoyerTarget[]): string {
  const lines: string[] = []
  for (const target of targets) {
    lines.push(`[TRUQUITO_TARGET ${target.id}] kind=${target.kind} importance=${target.importanceTier}`)
    lines.push(`ESTRATEGIAS ELEGIBLES: ${target.strategyOpportunities.join(', ')}`)
    lines.push(`LABEL: ${target.label}`)
    lines.push(`CONTENIDO AUTORIZADO: ${target.content}`)
    const evidenceLines = target.evidence.filter(row => row.quote)
    if (evidenceLines.length) {
      lines.push('EVIDENCE:')
      for (const row of evidenceLines) lines.push(`  - "${row.quote}"`)
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

/** Deterministic coverage over the ELIGIBLE universe only — never "all Enjoyer targets". Provider never decides the denominator. */
export function computeTruquitosCoverage(
  eligibleTargets: readonly TruquitoEnjoyerTarget[],
  representedTargetIds: readonly string[],
): TruquitosCoverageResult {
  const total = eligibleTargets.map(target => target.id)
  const represented = new Set(representedTargetIds)
  const missingTargetIds = total.filter(id => !represented.has(id))
  const representedCount = total.length - missingTargetIds.length
  return {
    totalEligibleTargets: total.length,
    representedEligibleTargets: representedCount,
    coveragePercent: total.length === 0 ? 0 : Math.round((representedCount / total.length) * 10000) / 100,
    missingTargetIds,
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

/**
 * TRUQUITOS_LIVE_HARDENING #2: exact-target-set dedup (above) only
 * catches two cards grounded in the IDENTICAL target set. The live
 * CLUTCH 2.pdf test showed 8 separate cards all covering the SAME
 * p.28-33 ICE/Kc workflow with overlapping-but-not-identical target
 * sets ("Tabla ICE" grounded in {A,B}, "Cálculo de concentraciones" in
 * {B,C}, "Kc: el último paso" in {C}, etc.) — each individually passes
 * the exact-identity check while collectively repeating the same
 * student benefit many times over.
 *
 * Deterministic, bounded (single pass over an already-small ~20-30
 * card batch), and grounded ONLY in existing metadata — never a new
 * provider call, never a text-similarity/keyword heuristic:
 *   - two cards are candidates for consolidation when they share the
 *     SAME topic (via their primary target's topicId — the same
 *     grounded passage) AND their targetId sets overlap by at least
 *     `overlapThreshold` (Jaccard similarity) — i.e. they are
 *     substantially grounded in the same academic content, not merely
 *     adjacent.
 *   - within such a cluster, ONE card per DISTINCT `type` survives
 *     (the one with the broadest grounding — most targetIds — a
 *     content-blind, deterministic tiebreaker) — this is what
 *     preserves genuinely different pedagogical tricks (e.g. a
 *     mnemonic vs. a formula_memory vs. an exam_cue about the same
 *     passage each serve a different cognitive purpose and are kept)
 *     while collapsing multiple cards of the SAME strategy that only
 *     restate the same workflow from a slightly different angle.
 *   - clusters of size 1 (a card with no sufficiently-overlapping
 *     sibling) are always kept untouched.
 * Original relative order is preserved — this never re-ranks, only
 * removes redundant entries.
 */
export function consolidateOverlappingTruquitos<T extends TruquitoCardCandidate & { id: string }>(
  cards: readonly T[],
  targets: readonly TruquitoEnjoyerTarget[],
  options: { overlapThreshold?: number } = {},
): T[] {
  const overlapThreshold = options.overlapThreshold ?? 0.6
  if (cards.length <= 1) return [...cards]
  const targetById = new Map(targets.map(target => [target.id, target]))
  const topicOf = (card: T): string | null => targetById.get(card.targetIds[0])?.topicId ?? null

  // Union-find over cards whose grounding substantially overlaps within the same topic.
  const parent = cards.map((_, index) => index)
  function find(i: number): number {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] }
    return i
  }
  function union(a: number, b: number): void {
    const rootA = find(a); const rootB = find(b)
    if (rootA !== rootB) parent[rootA] = rootB
  }

  // TRUQUITOS_LIVE_FAILURES #2: the real CLUTCH artifact showed the
  // Jaccard(targetIds) gate never firing across the p.28-33 ICE/Kc
  // cluster — the grounded prompt instructs "AT MOST one Truquito per
  // target", so real cards are near-always singleton-grounded (one
  // targetId each). Two singleton-grounded cards on DIFFERENT targets
  // within the SAME topic always have Jaccard = 0 and never unite, even
  // though they restate the same conceptual workflow. topicId is itself
  // the Enjoyer's own grounded-passage grouping (existing structured
  // metadata, not a keyword search), so when it is present it is used
  // directly as the cluster key; the Jaccard(targetIds) rule remains the
  // fallback only for targets the Enjoyer left topicless, where topic
  // alone cannot be used as the connecting signal.
  for (let i = 0; i < cards.length; i++) {
    const topicI = topicOf(cards[i])
    const setI = new Set(cards[i].targetIds)
    for (let j = i + 1; j < cards.length; j++) {
      const topicJ = topicOf(cards[j])
      if (topicI !== null && topicI === topicJ) { union(i, j); continue }
      if (topicI !== topicJ) continue
      const setJ = new Set(cards[j].targetIds)
      const union_ = new Set([...setI, ...setJ])
      if (!union_.size) continue
      const intersectionSize = [...setI].filter(id => setJ.has(id)).length
      if (intersectionSize / union_.size >= overlapThreshold) union(i, j)
    }
  }

  const groups = new Map<number, number[]>()
  cards.forEach((_, index) => {
    const root = find(index)
    groups.set(root, [...(groups.get(root) || []), index])
  })

  const keptIds = new Set<string>()
  for (const indices of groups.values()) {
    if (indices.length === 1) { keptIds.add(cards[indices[0]].id); continue }
    const bestByType = new Map<string, T>()
    for (const index of indices) {
      const card = cards[index]
      const existing = bestByType.get(card.type)
      if (!existing || card.targetIds.length > existing.targetIds.length) bestByType.set(card.type, card)
    }
    for (const card of bestByType.values()) keptIds.add(card.id)
  }
  return cards.filter(card => keptIds.has(card.id))
}
