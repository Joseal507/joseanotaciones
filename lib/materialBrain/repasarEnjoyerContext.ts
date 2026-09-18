import { resolveMaterialLanguage } from '../materialLanguage'
import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'
import type {
  RepasarGroundedContext,
  RepasarRelationContext,
  RepasarReviewTarget,
} from './reviewContext'

export const REPASAR_ENJOYER_AUTHORITY = 'studyal_material_enjoyer' as const
export const REPASAR_ENJOYER_ADAPTER_VERSION = '1.0.0'

type EnjoyerAuthority = {
  sourceSelectionFingerprint?: unknown
  globalOrderedAnalysis?: unknown[]
  uniqueConceptsIndex?: unknown[]
  topicsIndex?: unknown[]
}

function authorityFrom(payload: unknown): EnjoyerAuthority {
  const wrapped = payload as { blueprint?: EnjoyerAuthority } | null
  return (wrapped?.blueprint || payload || {}) as EnjoyerAuthority
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(String).map(item => item.trim()).filter(Boolean))]
    : []
}

function pages(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value.map(Number).filter(page => Number.isInteger(page) && page > 0))].sort((a, b) => a - b)
    : []
}

function spans(value: unknown): { page: number; quote: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(raw => {
    const span = raw as Record<string, unknown>
    const page = Number(span.page)
    const quote = String(span.quote || span.text || '').trim()
    return Number.isInteger(page) && page > 0 && quote ? [{ page, quote }] : []
  })
}

function canonicalIdentity(label: string, statement: string): string {
  return `${label.normalize('NFKC').trim().toLowerCase()}::${statement.normalize('NFKC').trim().toLowerCase()}`
}

/** Whitespace/case-insensitive normalization for evidence-quote identity — never semantic, purely textual. */
function normalizeQuote(quote: string): string {
  return quote.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Pure authority adapter. It serializes the already-persisted Enjoyer into
 * Repasar's mature evaluation contract; it does not infer concepts, relations,
 * or academic meaning.
 */
export function buildRepasarEnjoyerGroundedContext(
  payload: unknown,
  selection: SourceSelectionSnapshot,
): RepasarGroundedContext {
  const authority = authorityFrom(payload)
  if (authority.sourceSelectionFingerprint !== selection.fingerprint) {
    throw new Error('SOURCE_SELECTION_MISMATCH')
  }

  const selectedPages = new Map(
    selection.materials.map(material => [material.materialId, new Set(material.selectedPages)]),
  )
  const topics = (Array.isArray(authority.topicsIndex) ? authority.topicsIndex : []).map((raw, index) => {
    const topic = raw as Record<string, unknown>
    return {
      id: String(topic.id || `topic_${index}`),
      title: String(topic.title || topic.name || '').trim(),
      order: Number(topic.order ?? index),
    }
  })
  const topicTitles = new Map(topics.map(topic => [topic.id, topic.title]))
  const targets: RepasarReviewTarget[] = []
  const relations: RepasarRelationContext[] = []
  const seenIds = new Set<string>()
  const seenExact = new Set<string>()
  const nonAcademicKinds = new Set(['metadata', 'decorative', 'divider', 'heading'])
  // Evidence-identity dedup: two Enjoyer items backed by the EXACT SAME
  // textual quote are the same academic fact, even when their labels
  // differ ("Definición de X" vs "Condición de X" both citing the same
  // sentence). Grading them as two independent targets is how the same
  // evidence ends up simultaneously "demonstrated_correct" for one and
  // "omitted" for the other — a real live contradiction. This is a
  // purely textual/evidentiary rule, never a semantic guess, and never
  // hardcoded to any specific concept.
  const targetIndexByQuote = new Map<string, number>()
  const idAlias = new Map<string, string>()
  const rawItems = [
    ...(Array.isArray(authority.globalOrderedAnalysis) ? authority.globalOrderedAnalysis : []),
    ...(Array.isArray(authority.uniqueConceptsIndex) ? authority.uniqueConceptsIndex : []),
  ]

  rawItems.forEach((raw, index) => {
    const item = raw as Record<string, unknown>
    const id = String(item.id || '').trim()
    const kind = String(item.kind || 'concept').trim()
    const label = String(item.name || item.label || item.title || '').trim()
    const statement = String(item.summary || item.content || item.statement || '').trim()
    if (!id || seenIds.has(id) || !label || !statement || nonAcademicKinds.has(kind)) return

    const materialIds = strings(item.materialIds)
    const materialId = String(item.materialId || materialIds[0] || (selection.materialIds.length === 1 ? selection.materialIds[0] : '') || '').trim()
    // Identity is scoped per material: identical wording in two materials is two independent sources.
    const identity = `${materialId}::${canonicalIdentity(label, statement)}`
    if (seenExact.has(identity)) return

    const itemSpans = spans(item.sourceSpans)
    const itemPages = pages(item.pages).length ? pages(item.pages) : pages(itemSpans.map(span => span.page))
    const allowedPages = selectedPages.get(materialId)
    if (!allowedPages || itemPages.some(page => !allowedPages.has(page))) {
      throw new Error('SOURCE_SELECTION_MISMATCH')
    }

    const topicIds = strings(item.topicIds)
    const topicId = String(item.topicId || topicIds[0] || '').trim() || null

    // Evidence-identity dedup — an item citing a quote already claimed by
    // an existing target is the same academic fact under a different
    // label/framing: merge into the existing target instead of creating
    // a second, independently-graded id. Relations pointing at this id
    // are transparently remapped to the canonical target via idAlias.
    const quoteKeys = itemSpans.map(span => normalizeQuote(span.quote)).filter(Boolean).map(key => `${materialId}::${key}`) // per-material: never merge evidence across materials
    const existingIndex = quoteKeys.map(key => targetIndexByQuote.get(key)).find(value => value !== undefined)
    if (existingIndex !== undefined) {
      const existing = targets[existingIndex]
      seenIds.add(id)
      seenExact.add(identity)
      idAlias.set(id, existing.id)
      if (!existing.statement.toLowerCase().includes(statement.toLowerCase())) {
        existing.statement = `${existing.statement} ${statement}`.trim()
        existing.evidenceText = existing.sourceSpans[0]?.quote || existing.statement
      }
      const mergedPages = [...new Set([...existing.pages, ...itemPages])].sort((a, b) => a - b)
      existing.pages = mergedPages
      existing.page = mergedPages[0] ?? existing.page
      const seenSpanKeys = new Set(existing.sourceSpans.map(span => `${span.page}:${normalizeQuote(span.quote)}`))
      for (const span of itemSpans) {
        const key = `${span.page}:${normalizeQuote(span.quote)}`
        if (!seenSpanKeys.has(key)) { existing.sourceSpans.push(span); seenSpanKeys.add(key) }
      }
      return
    }

    seenIds.add(id)
    seenExact.add(identity)
    for (const key of quoteKeys) if (!targetIndexByQuote.has(key)) targetIndexByQuote.set(key, targets.length)
    targets.push({
      materialLanguage: resolveMaterialLanguage(payload),
      id,
      unitId: id,
      kind,
      label,
      statement,
      importanceTier: Number(item.importance ?? 50) >= 80
        ? 'critical'
        : Number(item.importance ?? 50) < 30 ? 'contextual' : 'supporting',
      difficulty: String(item.difficulty || '').trim() || null,
      topicId,
      topicTitle: topicId ? topicTitles.get(topicId) || null : null,
      sourceOrder: Number(item.globalOrder ?? item.firstAppearanceOrder ?? index),
      materialId,
      page: itemPages[0] ?? null,
      pages: itemPages,
      sourceSpans: itemSpans,
      derivation: null,
      evidenceText: itemSpans[0]?.quote || statement,
    })
  })

  targets.sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0) || a.id.localeCompare(b.id))
  if (!targets.length) throw new Error('INSUFFICIENT_KNOWLEDGE')

  const knownIds = new Set(targets.map(target => target.id))
  const resolveTargetId = (rawId: string): string => idAlias.get(rawId) || rawId
  for (const raw of rawItems) {
    const item = raw as Record<string, unknown>
    const fromTargetId = resolveTargetId(String(item.id || '').trim())
    if (!knownIds.has(fromTargetId) || !Array.isArray(item.relations)) continue
    item.relations.forEach((rawRelation, index) => {
      const relation = rawRelation as Record<string, unknown>
      const toTargetId = resolveTargetId(String(relation.targetId || relation.target || '').trim())
      const type = String(relation.type || '').trim()
      if (!knownIds.has(toTargetId) || fromTargetId === toTargetId || !type) return
      relations.push({
        id: String(relation.id || `${fromTargetId}:${type}:${toTargetId}:${index}`),
        type,
        statement: String(relation.statement || relation.description || '').trim(),
        fromTargetId,
        toTargetId,
      })
    })
  }

  return {
    materialLanguage: resolveMaterialLanguage(payload),
    fingerprint: selection.fingerprint,
    builderVersion: REPASAR_ENJOYER_ADAPTER_VERSION,
    authorityType: REPASAR_ENJOYER_AUTHORITY,
    targets,
    relations,
    topics,
  }
}
