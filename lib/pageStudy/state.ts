import { canonicalizeSelectedPages } from '../adaptive/sourceSelection'
import { buildAuthorityBatches, normalizePlanMaterials } from './batching'
import { narrowUniverse, normalizeBlockSize, planAllBlocks, planMaterialBlocks } from './blocks'
import { clip, conceptStatus, escalate, isChecked, isWeak, MAX_CARRYOVER_CARDS, newConcept, recordAttempt } from './evidence'
import { planIdOf, planKeyOf } from './identity'
import type { AuthorityBatch, BlockPlan, BlockProgress, ConceptRecord, MisconceptionRecord, PageStudyPlan, PageStudyState, RecheckCard, StateDelta } from './types'

/**
 * Pure Page Study reducer. The state machine is an INTERNAL continuity guard: nothing in it is a visible phase. It only
 * answers "where were we, what is pending, what did the student show" so that closing, reopening or interrupting can
 * never lose or duplicate progress. Every transition is deterministic (time comes from the delta) and replayable.
 */
export const MAX_SCOPE_NOTES = 8
const errors = { stale: 'PAGE_STUDY_STALE_REVISION', order: 'PAGE_STUDY_TURN_OUT_OF_ORDER', pending: 'PAGE_STUDY_PENDING_EXISTS', noPending: 'PAGE_STUDY_NO_PENDING', block: 'PAGE_STUDY_NOT_CURRENT_BLOCK', unknownBlock: 'PAGE_STUDY_UNKNOWN_BLOCK', unknownConcept: 'PAGE_STUDY_UNKNOWN_CONCEPT' } as const

export function createPageStudyPlan(input: {
  userId: string; temaId: string; materials: ReadonlyArray<{ materialId?: unknown; id?: unknown; name?: unknown; selectedPages?: unknown }>
  blockSize?: number; universe: Record<string, number[]>
}): PageStudyPlan {
  const materials = normalizePlanMaterials(input.materials)
  if (!materials.length) throw new Error('PAGE_STUDY_NO_MATERIALS')
  const planKey = planKeyOf(materials)
  const planId = planIdOf(input.userId, input.temaId, planKey)
  const batches = buildAuthorityBatches(planId, materials)
  const universe = Object.fromEntries(materials.map(m => [m.materialId, canonicalizeSelectedPages(input.universe[m.materialId] || [])]))
  const blockSize = normalizeBlockSize(input.blockSize)
  const blocks = planAllBlocks(materials, universe, batches, blockSize)
  if (!blocks.length) throw new Error('PAGE_STUDY_NOTHING_TO_STUDY')
  return { planId, planKey, temaId: input.temaId, materials, batches, blockSize, universe, blocks, scopeNotes: [] }
}

const emptyProgress = (status: BlockProgress['status'] = 'pending'): BlockProgress =>
  ({ status, totalUnits: 0, taught: [], projected: [], deferred: [], unitsSinceCheck: 0, checksAsked: 0, evalAsked: 0, rechecks: 0, wrapped: false, forced: false })

export function createInitialState(plan: PageStudyPlan, at: number): PageStudyState {
  return {
    version: 1, planId: plan.planId, revision: 0, turnSeq: 0, plan, cursor: { blockIdx: 0 },
    progress: Object.fromEntries(plan.blocks.map((b, i) => [b.blockKey, emptyProgress(i === 0 ? 'active' : 'pending')])),
    pending: null, concepts: {}, misconceptions: [], carryover: [], prefs: { pace: 'steady' }, updatedAt: at,
  }
}

// ── selectors ──────────────────────────────────────────────────────────────────────────────────────────────
export const isFinished = (s: PageStudyState): boolean => s.cursor.blockIdx >= s.plan.blocks.length
export const currentBlock = (s: PageStudyState): BlockPlan | null => s.plan.blocks[s.cursor.blockIdx] ?? null
export const currentBatch = (s: PageStudyState): AuthorityBatch | null => {
  const block = currentBlock(s)
  return block ? s.plan.batches[block.batchIndex] ?? null : null
}
/** Pages of already-completed blocks of one material (the "previously studied" pages of the allowed set). */
export const studiedPagesOf = (s: PageStudyState, materialId: string): number[] =>
  s.plan.blocks.filter(b => b.materialId === materialId && s.progress[b.blockKey]?.status === 'done').flatMap(b => b.pages)
export const taughtClassByUnit = (s: PageStudyState, materialId: string): Record<string, 'FULL' | 'PROJECTED'> =>
  Object.fromEntries(Object.values(s.concepts).filter(c => c.materialId === materialId).map(c => [c.unitRef, c.taughtClass]))
export const deferredOf = (s: PageStudyState, materialId: string): string[] =>
  [...new Set(s.plan.blocks.filter(b => b.materialId === materialId).flatMap(b => s.progress[b.blockKey]?.deferred || []))].filter(ref => !s.concepts[ref] || s.concepts[ref].taughtClass !== 'FULL')

/** Coverage / progress only. There is deliberately no mastery percentage in this module. */
export function coverageOf(s: PageStudyState): {
  block: { taught: number; projected: number; total: number; pct: number }
  plan: { pagesDone: number; pagesTotal: number; pct: number }
  concepts: { checked: number; taught: number; demonstrated: number }
} {
  const block = currentBlock(s)
  const p = block ? s.progress[block.blockKey] : undefined
  const total = p?.totalUnits || 0
  const bPct = !block ? 100 : total > 0 ? Math.min(100, Math.round((100 * ((p!.taught.length) + 0.5 * p!.projected.length)) / total)) : 0
  const pagesTotal = s.plan.blocks.reduce((n, b) => n + b.pages.length, 0)
  const done = s.plan.blocks.filter(b => s.progress[b.blockKey]?.status === 'done').reduce((n, b) => n + b.pages.length, 0)
  const partial = block ? (block.pages.length * bPct) / 100 : 0
  const planPct = pagesTotal ? Math.min(100, Math.round((100 * (done + partial)) / pagesTotal)) : 100
  // "pagesDone" is a LITERAL, discrete count of pages whose block has truly finished — never
  // derived from `planPct`. An earlier fix tried deriving pagesDone from planPct (rounding the
  // fraction to a page count) to make the two numbers agree on screen; that was mathematically
  // consistent but semantically dishonest: for a 2-page block, planPct=25% rounds to
  // pagesDone=1, claiming a whole page finished when in truth zero pages have. There is no
  // per-page unit total in this state to compute TRUE sub-block page traversal (a concept only
  // records the pages it touches once it is taught, not the total units a page still owes), so
  // rather than fabricate that precision, pagesDone stays a plain whole-block completion count
  // and planPct stays continuous content coverage — two intentionally different, both truthful,
  // metrics. The UI must label them as different things, not imply they are the same fraction.
  const concepts = Object.values(s.concepts)
  return {
    block: { taught: p?.taught.length || 0, projected: p?.projected.length || 0, total, pct: bPct },
    plan: { pagesDone: done, pagesTotal, pct: planPct },
    concepts: { checked: concepts.filter(isChecked).length, taught: concepts.length, demonstrated: concepts.filter(c => ['demonstrated', 'retained'].includes(conceptStatus(c))).length },
  }
}

// ── bounded, derived cross-batch study memory ──────────────────────────────────────────────────────────────
export interface DigestItem { unitRef: string; materialId: string; label: string; pages: number[]; status: string; misconception?: string; correctStatement?: string; due: boolean }
/** What may cross authority batches: labels, pages, status and the student's own misconception — never source text. */
export function buildStudyDigest(s: PageStudyState, maxItems = 12): DigestItem[] {
  const cards = s.carryover.filter(c => c.checks < 3).sort((a, b) => b.attempts - a.attempts || a.createdSeq - b.createdSeq)
  const items: DigestItem[] = cards.map(c => ({ unitRef: c.unitRef, materialId: c.materialId, label: c.label, pages: c.pages, status: 'weak', misconception: c.misconception, correctStatement: c.correctStatement, due: true }))
  const seen = new Set(items.map(i => i.unitRef))
  for (const c of Object.values(s.concepts).sort((a, b) => b.taughtSeq - a.taughtSeq)) {
    if (items.length >= maxItems) break
    if (seen.has(c.unitRef)) continue
    const st = conceptStatus(c)
    if (st === 'taught' && !c.attempts.length) continue
    items.push({ unitRef: c.unitRef, materialId: c.materialId, label: c.label, pages: c.pages, status: st, due: false })
  }
  return items.slice(0, maxItems)
}
export const dueRechecks = (s: PageStudyState): RecheckCard[] => s.carryover.filter(c => c.checks < 3).sort((a, b) => b.attempts - a.attempts || a.createdSeq - b.createdSeq)

// ── reducer ────────────────────────────────────────────────────────────────────────────────────────────────
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function rebuildPendingBlocks(s: PageStudyState, materialId: string, newPages: number[]): void {
  const plan = s.plan
  const batchIndex = plan.blocks.find(b => b.materialId === materialId)?.batchIndex ?? 0
  const kept: BlockPlan[] = []
  let inserted = false
  const pendingPagesAllowed = new Set(newPages)
  const keptPages = new Set(plan.blocks.filter(b => b.materialId === materialId && s.progress[b.blockKey]?.status !== 'pending').flatMap(b => b.pages))
  for (const block of plan.blocks) {
    if (block.materialId !== materialId || s.progress[block.blockKey]?.status !== 'pending') { kept.push(block); continue }
    delete s.progress[block.blockKey]
    if (!inserted) {
      inserted = true
      const remaining = [...pendingPagesAllowed].filter(p => !keptPages.has(p)).sort((a, b) => a - b)
      for (const nb of planMaterialBlocks(materialId, remaining, plan.blockSize, batchIndex, 0)) { kept.push(nb); s.progress[nb.blockKey] = emptyProgress() }
    }
  }
  plan.blocks = kept.map((b, i) => ({ ...b, index: i }))
}

function makeCard(s: PageStudyState, c: ConceptRecord, block: BlockPlan, seq: number): RecheckCard {
  const misc = s.misconceptions.find(m => m.unitRef === c.unitRef && m.status !== 'corrected')
  const last = c.attempts[c.attempts.length - 1]
  return {
    cardId: `card:${c.unitRef}`, unitRef: c.unitRef, materialId: c.materialId, batchIndex: block.batchIndex, label: c.label, kind: c.kind, pages: c.pages,
    misconception: misc ? clip(misc.statement, 200) : undefined, correctStatement: misc ? clip(misc.correctStatement, 200) : undefined,
    attempts: c.attempts.filter(a => a.verdict !== 'correct').length, lastVerdict: last?.verdict ?? 'incorrect', createdSeq: seq, checks: 0,
  }
}

export function applyDelta(state: PageStudyState, delta: StateDelta): PageStudyState {
  if (delta.baseRevision !== state.revision) throw new Error(errors.stale)
  if (delta.turnSeq !== state.turnSeq + 1) throw new Error(errors.order)
  const s = clone(state)
  const seq = delta.turnSeq
  const block = () => currentBlock(s)
  const progressOf = (key: string): BlockProgress => { const p = s.progress[key]; if (!p) throw new Error(errors.unknownBlock); return p }

  for (const op of delta.ops) {
    switch (op.op) {
      case 'units': progressOf(op.blockKey).totalUnits = Math.max(0, Math.floor(op.total)); break
      case 'teach': {
        const p = progressOf(op.blockKey)
        for (const meta of op.units) {
          const existing = s.concepts[meta.unitRef]
          if (!existing) s.concepts[meta.unitRef] = newConcept(meta, op.klass, seq)
          else if (op.klass === 'FULL') s.concepts[meta.unitRef] = { ...existing, taughtClass: 'FULL' }
          p.deferred = p.deferred.filter(r => r !== meta.unitRef)
          if (op.klass === 'FULL') { p.projected = p.projected.filter(r => r !== meta.unitRef); if (!p.taught.includes(meta.unitRef)) p.taught.push(meta.unitRef) }
          else if (!p.taught.includes(meta.unitRef) && !p.projected.includes(meta.unitRef)) p.projected.push(meta.unitRef)
        }
        p.unitsSinceCheck += op.units.length
        break
      }
      case 'defer': { const p = progressOf(op.blockKey); for (const ref of op.unitRefs) if (!p.deferred.includes(ref) && !p.taught.includes(ref)) p.deferred.push(ref); break }
      case 'ask': {
        if (s.pending && !op.replace) throw new Error(errors.pending)
        s.pending = { ref: op.ref, unitRefs: [...op.unitRefs], format: op.format, askedSeq: seq, helpLevel: 'independent', clarifications: 0 }
        const b = block(); const p = b ? s.progress[b.blockKey] : undefined
        if (p && op.kind === 'mini') { p.checksAsked++; p.unitsSinceCheck = 0 }
        if (p && op.kind === 'eval') { p.evalAsked++; p.unitsSinceCheck = 0 }
        if (p && op.kind === 'recheck') { p.rechecks++; for (const card of s.carryover) if (op.unitRefs.includes(card.unitRef)) card.checks++ }
        break
      }
      case 'help': {
        // A doubt, a clarification or a hint NEVER consumes the pending question; it can only lower the independence of the eventual answer.
        if (!s.pending) break
        if (op.kind === 'hint') s.pending.helpLevel = escalate(s.pending.helpLevel, 'minimal_hint')
        if (op.kind === 'clarification') s.pending.helpLevel = escalate(s.pending.helpLevel, 'guided')
        if (op.kind === 'reveal') s.pending.helpLevel = escalate(s.pending.helpLevel, 'revealed')
        if (op.kind !== 'question') s.pending.clarifications++
        break
      }
      case 'answer': {
        if (!s.pending) throw new Error(errors.noPending)
        const b = block()
        const blockIndex = b?.index ?? 0
        for (const ref of s.pending.unitRefs) {
          const concept = s.concepts[ref]
          if (!concept) throw new Error(errors.unknownConcept)
          const updated = recordAttempt(concept, { turnSeq: seq, verdict: op.verdict, assistance: s.pending.helpLevel, at: delta.at, digest: op.digest, blockKey: b?.blockKey ?? '', blockIndex })
          s.concepts[ref] = updated
          if (op.verdict === 'correct') {
            for (const m of s.misconceptions) if (m.unitRef === ref && m.status !== 'corrected') { m.status = 'corrected'; m.correctedSeq = seq }
            if (isWeak(updated) === false) s.carryover = s.carryover.filter(card => card.unitRef !== ref) // independent success resolves the recheck
          } else {
            const card = s.carryover.find(c => c.unitRef === ref)
            if (card) { card.attempts++; card.lastVerdict = op.verdict }
            if (op.misconception) {
              const statement = clip(op.misconception.statement, 200)
              const found = s.misconceptions.find(m => m.unitRef === ref && m.statement === statement)
              if (found) { found.observations++; found.lastSeq = seq; found.status = found.status === 'corrected' ? 'relapsed' : found.observations >= 3 ? 'confirmed' : 'testing'; delete found.correctedSeq }
              else s.misconceptions.push({ id: `misc:${ref}:${s.misconceptions.length + 1}`, unitRef: ref, statement, correctStatement: clip(op.misconception.correctStatement, 200), status: 'suspected', observations: 1, firstSeq: seq, lastSeq: seq } as MisconceptionRecord)
            }
          }
        }
        s.pending = null
        break
      }
      case 'wrap': progressOf(op.blockKey).wrapped = true; break
      case 'complete': {
        const b = block()
        if (!b || b.blockKey !== op.blockKey) throw new Error(errors.block)
        const p = progressOf(op.blockKey)
        p.status = 'done'; p.forced = op.forced === true
        for (const ref of [...p.taught, ...p.projected]) {
          const c = s.concepts[ref]
          if (c && isWeak(c) && !s.carryover.some(card => card.unitRef === ref)) s.carryover.push(makeCard(s, c, b, seq))
        }
        s.carryover = s.carryover.slice(-MAX_CARRYOVER_CARDS)
        s.pending = null
        s.cursor.blockIdx += 1
        const next = s.plan.blocks[s.cursor.blockIdx]
        if (next) s.progress[next.blockKey] = { ...(s.progress[next.blockKey] || emptyProgress()), status: 'active' }
        break
      }
      case 'narrow': {
        const before = s.plan.universe[op.materialId] || []
        const after = narrowUniverse(before, { upTo: op.upTo, ranges: op.ranges })
        s.plan.universe[op.materialId] = after
        rebuildPendingBlocks(s, op.materialId, after)
        break
      }
      case 'pace': s.prefs.pace = op.pace; break
      case 'note': s.plan.scopeNotes = [...s.plan.scopeNotes, clip(op.text, 240)].slice(-MAX_SCOPE_NOTES); break
    }
  }
  s.revision = state.revision + 1
  s.turnSeq = seq
  s.updatedAt = delta.at
  return s
}

/** Roll-forward helper: a delta whose turn is already reflected in the state is a no-op (a lost CAS response must not double-apply). */
export function applyDeltaIfPending(state: PageStudyState, delta: StateDelta): PageStudyState {
  return delta.turnSeq <= state.turnSeq ? state : applyDelta(state, delta)
}
