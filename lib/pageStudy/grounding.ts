import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'
import { normalizeSourceText, type SourceIndex } from '../materials/sourceIndex'

/**
 * Page-clipped, READ-ONLY grounding for one page block.
 *
 * Why this exists (verified in app/api/adaptive/blueprint/route.ts): an Enjoyer block's `pages` are its TOPIC's pages,
 * model-written spans get `page: topic.pages[0]`, and `summary` is synthesized over the whole topic text. So neither
 * `pages`, `span.page` nor `summary` prove where evidence lives. Rules implemented here:
 *
 *   FULL       every page the unit can draw on is inside the allowed set A → its fields are safe to serialize.
 *   PROJECTED  the unit reaches outside A, but ≥1 of its quotes is re-located VERBATIM in the real authorized text of
 *              pages inside A → only those quotes (with their re-derived pages) and the in-range text blocks that
 *              contain them are exposed. summary/content, misconceptions, relations and topic titles are withheld.
 *   DEFER      anything else. Never serialized; taught later, when it becomes FULL.
 *
 * The canonical Enjoyer payload is only ever read. Nothing here writes to it.
 */
export const MIN_PROJECTION_CHARS = 60
const MAX_SOURCE_BLOCK_CHARS = 700
const MAX_PROJECTED_BLOCKS = 2

export interface RawSpan { quote: string; recordedPage: number }
export interface RawUnit {
  unitRef: string; sourceItemId: string; materialId: string; kind: string; label: string; summary: string
  importance: number; difficulty: string; sourceOrder: number; topicId: string | null
  pages: number[]; rawSpans: RawSpan[]; misconceptions: string[]; related: string[]
}
export interface RawTopic { id: string; title: string; pages: number[]; materialId: string }

const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map(String).map(s => s.trim()).filter(Boolean))] : [])
const pageList = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.map(Number).filter(p => Number.isInteger(p) && p > 0))].sort((a, b) => a - b) : [])
const unitRefOf = (materialId: string, sourceItemId: string) => `${materialId}::${sourceItemId}`

/** Reads the persisted Enjoyer payload for ONE authority batch. Fail-closed on any identity mismatch; never mutates. */
export function extractRawUnits(payload: unknown, selection: SourceSelectionSnapshot): { units: RawUnit[]; topics: RawTopic[]; pageDispositions: Record<string, unknown> } {
  const root = (payload as { blueprint?: Record<string, unknown> } | null)?.blueprint ?? (payload as Record<string, unknown> | null) ?? {}
  if (String(root.sourceSelectionFingerprint || '') !== selection.fingerprint) throw new Error('SOURCE_SELECTION_MISMATCH')
  const persisted = strings(root.materialIds ?? (root.sourceSelection as { materialIds?: unknown } | undefined)?.materialIds).sort()
  if (persisted.length && JSON.stringify(persisted) !== JSON.stringify([...selection.materialIds].sort())) throw new Error('SOURCE_SELECTION_MISMATCH')
  const known = new Set(selection.materialIds)

  const topics: RawTopic[] = (Array.isArray(root.topicsIndex) ? root.topicsIndex : []).map((raw, index) => {
    const t = raw as Record<string, unknown>
    return { id: String(t.id || `topic_${index}`), title: String(t.title || t.name || '').trim(), pages: pageList(t.pages), materialId: String(t.materialId || '') }
  })
  const items = [...(Array.isArray(root.globalOrderedAnalysis) ? root.globalOrderedAnalysis : []), ...(Array.isArray(root.uniqueConceptsIndex) ? root.uniqueConceptsIndex : [])]
  const seen = new Set<string>()
  const units: RawUnit[] = []
  for (const [index, raw] of items.entries()) {
    const item = raw as Record<string, unknown>
    const sourceItemId = String(item.id || '').trim()
    const label = String(item.name || item.label || item.title || '').trim()
    const summary = String(item.summary || item.content || item.statement || '').trim()
    const ids = strings(item.materialIds)
    const materialId = String(item.materialId || (ids.length === 1 ? ids[0] : '') || (selection.materialIds.length === 1 ? selection.materialIds[0] : '') || '')
    if (!sourceItemId || !label || !summary || !materialId) continue
    if (!known.has(materialId)) throw new Error('SOURCE_SELECTION_MISMATCH') // a sixth/foreign material never enters a batch
    const ref = unitRefOf(materialId, sourceItemId)
    if (seen.has(ref)) continue
    seen.add(ref)
    const rawSpans: RawSpan[] = (Array.isArray(item.sourceSpans) ? item.sourceSpans : []).flatMap(s => {
      const span = s as Record<string, unknown>
      const quote = String(span.quote || span.text || '').trim()
      return quote ? [{ quote, recordedPage: Number(span.page) || 0 }] : []
    })
    const relations = Array.isArray(item.relations) ? item.relations : []
    units.push({
      unitRef: ref, sourceItemId, materialId, kind: String(item.kind || 'concept'), label, summary,
      importance: Number.isFinite(Number(item.importance)) ? Number(item.importance) : 50,
      difficulty: String(item.difficulty || 'intermediate'), sourceOrder: Number(item.globalOrder ?? item.firstAppearanceOrder ?? index),
      topicId: String(item.topicId || strings(item.topicIds)[0] || '') || null,
      pages: pageList(item.pages), rawSpans, misconceptions: strings(item.misconceptions).slice(0, 3),
      related: [...strings(item.dependsOn), ...relations.map(r => String((r as Record<string, unknown>)?.target ?? (r as Record<string, unknown>)?.toSourceItemId ?? '')).filter(Boolean)],
    })
  }
  units.sort((a, b) => a.sourceOrder - b.sourceOrder || a.unitRef.localeCompare(b.unitRef))
  return { units, topics, pageDispositions: (root.pageDispositions && typeof root.pageDispositions === 'object' ? root.pageDispositions : {}) as Record<string, unknown> }
}

/** Studyable pages of one material: the explicit selection, else every page the persisted Enjoyer knows about. */
export function derivePageUniverse(payload: unknown, selection: SourceSelectionSnapshot, materialId: string): number[] {
  const explicit = selection.selectedPages[materialId] || []
  if (explicit.length) return [...explicit]
  const { units, topics, pageDispositions } = extractRawUnits(payload, selection)
  const pages = new Set<number>()
  for (const key of Object.keys(pageDispositions)) {
    const at = key.lastIndexOf(':')
    if (at > 0 && key.slice(0, at) === materialId) { const p = Number(key.slice(at + 1)); if (Number.isInteger(p) && p > 0) pages.add(p) }
  }
  for (const u of units) if (u.materialId === materialId) { u.pages.forEach(p => pages.add(p)); u.rawSpans.forEach(s => s.recordedPage > 0 && pages.add(s.recordedPage)) }
  for (const t of topics) if (!t.materialId || t.materialId === materialId) t.pages.forEach(p => pages.add(p))
  return [...pages].sort((a, b) => a - b)
}

// ── real per-page source text (read from the EXISTING SourceIndex; no extraction here) ─────────────────────────
interface PageBlock { text: string; normalized: string; tokens: Set<string> }
export type PageTextIndex = Map<string, Map<number, PageBlock[]>>

export function buildPageTextIndex(index: SourceIndex): PageTextIndex {
  const out: PageTextIndex = new Map()
  for (const block of index.blocks) {
    if (block.page == null) continue
    const byPage = out.get(block.materialId) ?? new Map<number, PageBlock[]>()
    out.set(block.materialId, byPage)
    byPage.set(block.page, [...(byPage.get(block.page) || []), { text: block.text, normalized: block.normalizedText, tokens: new Set(block.normalizedText.split(' ').filter(Boolean)) }])
  }
  return out
}

/** Pages (inside `allowed` only) whose real text contains the quote. The RECORDED span page is never consulted. */
export function locateQuote(quote: string, materialId: string, allowed: ReadonlySet<number>, index: PageTextIndex): number[] {
  const nq = normalizeSourceText(quote)
  if (nq.length < 12) return []
  const qTokens = nq.split(' ').filter(t => t.length >= 3)
  const found: number[] = []
  for (const [page, blocks] of index.get(materialId) ?? []) {
    if (!allowed.has(page)) continue
    if (blocks.some(b => b.normalized.includes(nq) || (qTokens.length >= 5 && qTokens.filter(t => b.tokens.has(t)).length / qTokens.length >= 0.9))) found.push(page)
  }
  return found.sort((a, b) => a - b)
}

export type UnitClass = 'FULL' | 'PROJECTED' | 'DEFER'
export interface VerifiedEvidence { quote: string; pages: number[] }
export interface Classification { klass: UnitClass; reason: string; evidence: VerifiedEvidence[]; sourceBlocks: Array<{ page: number; text: string }> }

const labelSupported = (label: string, allowed: ReadonlySet<number>, materialId: string, index: PageTextIndex): boolean => {
  const tokens = normalizeSourceText(label).split(' ').filter(t => t.length >= 4)
  if (!tokens.length) return false
  const pool = [...(index.get(materialId) ?? [])].filter(([p]) => allowed.has(p)).flatMap(([, blocks]) => blocks)
  return tokens.every(t => pool.some(b => b.tokens.has(t) || b.normalized.includes(t)))
}

/** A CJK character carries roughly three Latin characters of information, so the sufficiency floor is script-fair. */
export const evidenceWeight = (quote: string): number => (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(quote) ? quote.length * 3 : quote.length)

export function classifyUnit(unit: RawUnit, allowed: ReadonlySet<number>, index: PageTextIndex): Classification {
  const reach = new Set<number>([...unit.pages, ...unit.rawSpans.map(s => s.recordedPage).filter(p => p > 0)])
  if (!reach.size) return { klass: 'DEFER', reason: 'no_page_evidence', evidence: [], sourceBlocks: [] }
  const evidence: VerifiedEvidence[] = []
  const seen = new Set<string>()
  for (const span of unit.rawSpans) {
    const pages = locateQuote(span.quote, unit.materialId, allowed, index)
    if (pages.length && !seen.has(span.quote)) { seen.add(span.quote); evidence.push({ quote: span.quote, pages }) }
  }
  if ([...reach].every(p => allowed.has(p))) return { klass: 'FULL', reason: 'all_pages_authorized', evidence, sourceBlocks: [] }
  const chars = evidence.reduce((sum, e) => sum + evidenceWeight(e.quote), 0)
  if (chars < MIN_PROJECTION_CHARS) return { klass: 'DEFER', reason: 'insufficient_authorized_evidence', evidence: [], sourceBlocks: [] }
  const sourceBlocks: Array<{ page: number; text: string }> = []
  for (const e of evidence) {
    const nq = normalizeSourceText(e.quote)
    for (const page of e.pages) {
      const block = (index.get(unit.materialId)?.get(page) || []).find(b => b.normalized.includes(nq) || nq.split(' ').filter(t => t.length >= 3).every(t => b.tokens.has(t)))
      if (block && sourceBlocks.length < MAX_PROJECTED_BLOCKS && !sourceBlocks.some(s => s.page === page && s.text === block.text.slice(0, MAX_SOURCE_BLOCK_CHARS))) sourceBlocks.push({ page, text: block.text.slice(0, MAX_SOURCE_BLOCK_CHARS) })
    }
  }
  return { klass: 'PROJECTED', reason: 'verified_in_range_evidence', evidence, sourceBlocks }
}

// ── what may reach a prompt ────────────────────────────────────────────────────────────────────────────────
export interface GroundedUnit {
  unitRef: string; materialId: string; klass: 'FULL' | 'PROJECTED'; kind: string; label: string
  text: string                                   // FULL: the unit's own summary. PROJECTED: '' (never synthesized text)
  evidence: VerifiedEvidence[]; sourceBlocks: Array<{ page: number; text: string }>
  pages: number[]                                // pages the evidence provably lives on (all inside the allowed set)
  misconceptions: string[]; relatedLabels: string[]
  remainderDeferred: boolean; importance: number; difficulty: string; upgraded: boolean
}
export interface BlockGrounding {
  materialId: string; blockPages: number[]; allowedPages: number[]
  units: GroundedUnit[]; deferred: string[]; topicTitles: string[]
}

export interface GroundingInput {
  units: readonly RawUnit[]; topics: readonly RawTopic[]; pageIndex: PageTextIndex
  materialId: string; blockPages: readonly number[]; studiedPages: readonly number[]
  taught: Record<string, 'FULL' | 'PROJECTED'>; deferred: readonly string[]
}

export function buildBlockGrounding(input: GroundingInput): BlockGrounding {
  const allowed = new Set<number>([...input.blockPages, ...input.studiedPages])
  const block = new Set<number>(input.blockPages)
  const mine = input.units.filter(u => u.materialId === input.materialId)   // same page number in another PDF is another world
  const cls = new Map(mine.map(u => [u.unitRef, classifyUnit(u, allowed, input.pageIndex)]))
  const fullLabel = new Map(mine.filter(u => cls.get(u.unitRef)!.klass === 'FULL').map(u => [u.sourceItemId, u.label]))
  const deferredBefore = new Set(input.deferred)
  const units: GroundedUnit[] = []
  const deferred: string[] = []
  for (const unit of mine) {
    const c = cls.get(unit.unitRef)!
    const reach = [...new Set([...unit.pages, ...unit.rawSpans.map(s => s.recordedPage).filter(p => p > 0)])]
    const taughtAs = input.taught[unit.unitRef]
    const touchesBlock = reach.some(p => block.has(p)) || deferredBefore.has(unit.unitRef) || taughtAs === 'PROJECTED' || reach.every(p => allowed.has(p))
    if (!touchesBlock) continue
    if (c.klass === 'DEFER') { if (reach.some(p => block.has(p)) || deferredBefore.has(unit.unitRef)) deferred.push(unit.unitRef); continue }
    if (taughtAs === 'FULL') continue
    if (taughtAs === 'PROJECTED' && c.klass === 'PROJECTED') continue
    if (c.klass === 'FULL') {
      units.push({
        unitRef: unit.unitRef, materialId: unit.materialId, klass: 'FULL', kind: unit.kind, label: unit.label, text: unit.summary,
        evidence: c.evidence, sourceBlocks: [], pages: [...new Set(c.evidence.flatMap(e => e.pages).concat(c.evidence.length ? [] : reach))].sort((a, b) => a - b),
        misconceptions: unit.misconceptions, relatedLabels: unit.related.map(id => fullLabel.get(id)).filter((l): l is string => Boolean(l)),
        remainderDeferred: false, importance: unit.importance, difficulty: unit.difficulty, upgraded: taughtAs === 'PROJECTED',
      })
    } else {
      const bestQuote = c.evidence[0]?.quote || ''
      const label = labelSupported(unit.label, allowed, unit.materialId, input.pageIndex) ? unit.label : `${unit.kind}: ${bestQuote.split(/\s+/).slice(0, 6).join(' ')}`
      units.push({
        unitRef: unit.unitRef, materialId: unit.materialId, klass: 'PROJECTED', kind: unit.kind, label, text: '',
        evidence: c.evidence, sourceBlocks: c.sourceBlocks, pages: [...new Set(c.evidence.flatMap(e => e.pages))].sort((a, b) => a - b),
        misconceptions: [], relatedLabels: [], remainderDeferred: true, importance: unit.importance, difficulty: unit.difficulty, upgraded: false,
      })
    }
  }
  const topicTitles = input.topics.filter(t => t.title && t.pages.length && t.pages.every(p => allowed.has(p)) && (!t.materialId || t.materialId === input.materialId)).map(t => t.title)
  return { materialId: input.materialId, blockPages: [...input.blockPages], allowedPages: [...allowed].sort((a, b) => a - b), units, deferred, topicTitles }
}

/** The ONLY serializer for prompt-bound grounding: a whitelist of fields, every page provably inside the allowed set. */
export function renderBlockGrounding(g: BlockGrounding): string {
  const lines: string[] = [`CURRENT BLOCK — material ${g.materialId} — pages ${g.blockPages[0]}–${g.blockPages[g.blockPages.length - 1]} (authorized pages: ${g.allowedPages.join(',')})`]
  if (g.topicTitles.length) lines.push(`Topics fully inside the authorized pages: ${g.topicTitles.join(' | ')}`)
  for (const u of g.units) {
    lines.push(`[${u.unitRef}] ${u.klass}${u.upgraded ? ' (now complete)' : ''} · ${u.kind} · ${u.label}`)
    if (u.text) lines.push(`  ${u.text}`)
    for (const e of u.evidence) lines.push(`  evidence p.${e.pages.join('/')}: "${e.quote}"`)
    for (const b of u.sourceBlocks) lines.push(`  page ${b.page} text: ${b.text}`)
    if (u.misconceptions.length) lines.push(`  common mistakes: ${u.misconceptions.join(' ; ')}`)
    if (u.relatedLabels.length) lines.push(`  related (already available): ${u.relatedLabels.join(' ; ')}`)
    if (u.remainderDeferred) lines.push('  note: only the quoted evidence is authorized for now; the rest of this concept comes in later pages — do not extend it.')
  }
  return lines.join('\n')
}
