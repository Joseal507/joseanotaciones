import { normalizeMaterialLanguage, resolveMaterialLanguage } from '../materialLanguage'
import { buildSourceIndex, type SourceIndex } from '../materials/sourceIndex'
import { buildBlockGrounding, buildPageTextIndex, extractRawUnits, renderBlockGrounding, type BlockGrounding, type GroundedUnit, type RawTopic, type RawUnit } from './grounding'
import { resolveBlockAuthority, PageStudyError, type BlockAuthority } from './service'
import { buildStudyDigest, currentBlock, deferredOf, dueRechecks, taughtClassByUnit, type DigestItem } from './state'
import { isWeak } from './evidence'
import type { PageStudyState, RecheckCard } from './types'

/**
 * Prompt-ready context for ONE turn: authority batch → canonical Enjoyer → real page text → frozen page-clipped grounding
 * + bounded previous-study digest. Everything is read-only; nothing here calls a provider or mutates the Enjoyer.
 */
export interface ContextDeps {
  /** Read-only restore of the persisted StudyalMaterialEnjoyer for one canonical (≤5 materials) selection. */
  lookupEnjoyer(fingerprint: string): Promise<unknown | null>
  /** Ownership-checked raw source of ONE material (the same text the SourceIndex is built from). */
  loadSource(materialId: string, userId: string): Promise<{ materialId: string; name: string; kind: string; rawText: string } | null>
}

export interface RecallCandidate { handle: string; unitRef: string; label: string; kind: 'card' | 'weak'; card?: RecheckCard; status: string }
export interface TutorContext {
  authority: BlockAuthority
  language: string
  grounding: BlockGrounding
  units: GroundedUnit[]                            // untaught grounded candidates, teaching order
  handleToUnit: Map<string, string>; unitToHandle: Map<string, string>
  groundingText: string                            // EXACTLY the grounding sent to the provider (chunk + already-taught), what the inspector checks
  chunkText: string; taughtText: string
  taughtHandles: Map<string, string>               // 'K1' → unitRef of a unit already taught in this material
  digest: DigestItem[]; digestText: string
  recall: RecallCandidate[]; cardHandles: Map<string, string>
  chunk: string[]                                  // handles offered for teaching this turn
  rawUnits: RawUnit[]; rawTopics: RawTopic[]       // whole batch, for the leak inspector ONLY (never serialized)
  materialNames: Record<string, string>
  sourceIndex: SourceIndex
}

const CHUNK_SIZE = 2
const TAUGHT_CONTEXT = 6
const bounded = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export function renderDigest(items: DigestItem[], names: Record<string, string>): string {
  if (!items.length) return '(none yet)'
  return items.map(i => {
    const pages = i.pages.length ? ` p.${i.pages[0]}${i.pages.length > 1 ? `–${i.pages[i.pages.length - 1]}` : ''}` : ''
    const mis = i.misconception ? ` | student believed: ${bounded(i.misconception, 140)}${i.correctStatement ? ` | correct: ${bounded(i.correctStatement, 140)}` : ''}` : ''
    return `- ${bounded(i.label, 90)} (${names[i.materialId] || i.materialId}${pages}) — ${i.status}${i.due ? ', DUE for recheck' : ''}${mis}`
  }).join('\n')
}

export async function resolveTutorContext(state: PageStudyState, deps: ContextDeps, userId: string): Promise<TutorContext> {
  const authority = resolveBlockAuthority(state)
  const payload = await deps.lookupEnjoyer(authority.fingerprint)
  if (!payload) throw new PageStudyError('PAGE_STUDY_ENJOYER_NOT_READY', state)
  const source = await deps.loadSource(authority.materialId, userId)
  if (!source?.rawText) throw new PageStudyError('PAGE_STUDY_SOURCE_UNAVAILABLE', state)

  let raw: ReturnType<typeof extractRawUnits>
  try { raw = extractRawUnits(payload, authority.selection) } catch { throw new PageStudyError('PAGE_STUDY_ENJOYER_MISMATCH', state) }
  // The real per-page text is indexed ONLY for the pages this turn may use: future page text is never even loaded.
  const sourceIndex = buildSourceIndex(authority.fingerprint, [{ materialId: source.materialId, materialName: source.name, kind: source.kind || 'pdf', rawText: source.rawText, selectedPages: authority.allowedPages }])
  const block = currentBlock(state)!
  const grounding = buildBlockGrounding({
    units: raw.units, topics: raw.topics, pageIndex: buildPageTextIndex(sourceIndex), materialId: authority.materialId,
    blockPages: authority.blockPages, studiedPages: authority.studiedPages,
    taught: taughtClassByUnit(state, authority.materialId), deferred: deferredOf(state, authority.materialId),
  })
  const units = grounding.units
  const handleToUnit = new Map(units.map((u, i) => [`#${i + 1}`, u.unitRef] as const))
  const unitToHandle = new Map([...handleToUnit].map(([h, r]) => [r, h] as const))
  const chunkUnits = units.slice(0, CHUNK_SIZE)
  // Already-taught units of THIS material, re-grounded through the same frozen rules (their pages are all authorized by definition).
  const regrounded = buildBlockGrounding({
    units: raw.units, topics: [], pageIndex: buildPageTextIndex(sourceIndex), materialId: authority.materialId,
    blockPages: authority.blockPages, studiedPages: authority.studiedPages, taught: {}, deferred: [],
  })
  const taughtOrder = Object.values(state.concepts).filter(c => c.materialId === authority.materialId).sort((a, b) => b.taughtSeq - a.taughtSeq).map(c => c.unitRef)
  const taughtUnits = taughtOrder.map(ref => regrounded.units.find(u => u.unitRef === ref)).filter((u): u is GroundedUnit => Boolean(u)).slice(0, TAUGHT_CONTEXT)
  const taughtHandles = new Map(taughtUnits.map((u, i) => [`K${i + 1}`, u.unitRef] as const))
  const render = (subset: GroundedUnit[], handles: Map<string, string>) => {
    let text = subset.length ? renderBlockGrounding({ ...grounding, units: subset }) : ''
    for (const [handle, ref] of handles) text = text.split(`[${ref}]`).join(`[${handle}]`)   // shorter, harder to mistype; content unchanged
    return text
  }
  const chunkText = render(chunkUnits, handleToUnit)
  const taughtText = render(taughtUnits, new Map([...taughtHandles].map(([h, r]) => [h, r] as const)))
  const groundingText = [chunkText, taughtText].filter(Boolean).join('\n')

  const materialNames = Object.fromEntries(state.plan.materials.map(m => [m.materialId, m.name]))
  const digest = buildStudyDigest(state, 10)
  const cards = dueRechecks(state)
  const recall: RecallCandidate[] = cards.slice(0, 3).map((card, i) => ({ handle: `R${i + 1}`, unitRef: card.unitRef, label: card.label, kind: 'card' as const, card, status: 'weak (carryover)' }))
  const weakHere = Object.values(state.concepts).filter(c => c.materialId === authority.materialId && isWeak(c) && !cards.some(k => k.unitRef === c.unitRef) && (c.attempts[c.attempts.length - 1]?.blockKey === block.blockKey))
  for (const c of weakHere.slice(0, 2)) recall.push({ handle: `R${recall.length + 1}`, unitRef: c.unitRef, label: c.label, kind: 'weak', status: 'weak in this block' })
  const cardHandles = new Map(recall.map(r => [r.handle, r.unitRef] as const))
  return {
    authority, language: resolveMaterialLanguage(payload), grounding, units, handleToUnit, unitToHandle, groundingText, chunkText, taughtText, taughtHandles,
    digest, digestText: renderDigest(digest, materialNames), recall, cardHandles,
    chunk: units.slice(0, CHUNK_SIZE).map(u => unitToHandle.get(u.unitRef)!), rawUnits: raw.units, rawTopics: raw.topics, materialNames, sourceIndex,
  }
}

export const responseLanguage = (value: unknown): string | undefined => normalizeMaterialLanguage(value)

// ── the prompt/context inspector: deterministic proof that nothing unauthorized is about to leave the server ─────────
/**
 * Returns the list of violations (empty = safe). Used before EVERY provider call; a non-empty result fails the turn closed with
 * zero provider work. It combines structural invariants with a content canary built from the whole persisted batch.
 */
export function inspectTutorPrompt(prompt: string, ctx: TutorContext): string[] {
  const violations: string[] = []
  const allowed = new Set(ctx.authority.allowedPages)
  const g = `${ctx.chunkText}\n${ctx.taughtText}`     // the pieces actually assembled into the prompt, never a separate summary field
  if (ctx.authority.selection.materialIds.length > 5) violations.push('batch_over_5_materials')
  if (!ctx.authority.selection.materialIds.includes(ctx.authority.materialId)) violations.push('material_not_in_batch')
  // 1. every page number that appears in the grounding section must be an authorized page
  const refs = [...g.matchAll(/(?:\bp\.|\bpage\s+)(\d+(?:\/\d+)*)/gi)].flatMap(m => m[1].split('/').map(Number))
  for (const page of refs) if (!allowed.has(page)) violations.push(`page_outside_authorized_set:${page}`)
  for (const b of ctx.grounding.units.flatMap(u => u.sourceBlocks)) if (!allowed.has(b.page)) violations.push(`source_block_page_outside:${b.page}`)
  // 2. no other material's unit may appear in the grounding section
  for (const u of ctx.rawUnits) if (u.materialId !== ctx.authority.materialId && (g.includes(u.unitRef) || g.includes(u.sourceItemId))) violations.push(`other_material_unit:${u.materialId}`)
  // 3. content canary: whole summaries / long quotes of units that are NOT authorized for this turn must not be in the prompt
  const included = new Map(ctx.grounding.units.map(u => [u.unitRef, u]))
  const allowedTexts = new Set<string>()
  for (const u of ctx.grounding.units) { if (u.klass === 'FULL' && u.text) allowedTexts.add(u.text); u.evidence.forEach(e => allowedTexts.add(e.quote)); u.sourceBlocks.forEach(b => allowedTexts.add(b.text)) }
  const pageTexts: string[] = []
  for (const block of ctx.sourceIndex.blocks) pageTexts.push(block.text)
  for (const u of ctx.rawUnits) {
    const inc = included.get(u.unitRef)
    const reach = [...new Set([...u.pages, ...u.rawSpans.map(x => x.recordedPage).filter(pg => pg > 0)])]
    const full = u.materialId === ctx.authority.materialId && (inc?.klass === 'FULL' || (reach.length > 0 && reach.every(pg => allowed.has(pg))))   // an already-taught unit is authorized, not a leak
    if (!full && u.summary.length >= 30 && !allowedTexts.has(u.summary) && prompt.includes(u.summary) && !pageTexts.some(t => t.includes(u.summary))) violations.push(`unauthorized_summary:${u.unitRef}`)
    for (const s of u.rawSpans) if (!full && s.quote.length >= 40 && !allowedTexts.has(s.quote) && prompt.includes(s.quote) && !pageTexts.some(t => t.includes(s.quote))) violations.push(`unauthorized_quote:${u.unitRef}`)
  }
  const allowedTitles = new Set(ctx.grounding.topicTitles)
  for (const t of ctx.rawTopics) if (t.title.length >= 8 && !allowedTitles.has(t.title) && t.pages.some(p => !allowed.has(p)) && prompt.includes(t.title) && !ctx.grounding.units.some(u => u.label === t.title)) violations.push(`unauthorized_topic_title:${t.id}`)
  // 4. the previous-study digest is derived study state only
  for (const item of ctx.digest) for (const u of ctx.rawUnits) if (u.summary.length >= 30 && (item.misconception ?? '').includes(u.summary)) violations.push('digest_carries_source_text')
  return [...new Set(violations)]
}
