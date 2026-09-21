import { coverageOf, currentBlock, isFinished } from './state'
import { startSlot, turnSlot } from './identity'
import type { PageStudyState } from './types'

/**
 * What a client may render. It deliberately exposes no internal enums, authority batch, fingerprint, unit refs or evidence:
 * only the visible conversation position, coverage (progress, never mastery) and the next durable slot to use.
 */
export interface PageStudyView {
  planId: string; revision: number; turnSeq: number; finished: boolean
  block: { blockKey: string; materialId: string; materialName: string; pageStart: number; pageEnd: number; index: number; total: number } | null
  coverage: { blockPct: number; planPct: number; pagesDone: number; pagesTotal: number; conceptsChecked: number; conceptsTaught: number }
  pending: { format: string } | null
  carryoverDue: number
  nextSlot: string | null
  materials: Array<{ materialId: string; name: string; blocksDone: number; blocksTotal: number; current: boolean }>
}

/** A block is "started" once anything was recorded for it; until then its first turn uses the block's start slot. */
export function blockStarted(state: PageStudyState): boolean {
  const block = currentBlock(state)
  const p = block ? state.progress[block.blockKey] : undefined
  return Boolean(p && (p.totalUnits > 0 || p.taught.length || p.projected.length || p.deferred.length || p.checksAsked || p.evalAsked))
}

export function nextSlotOf(state: PageStudyState): string | null {
  const block = currentBlock(state)
  if (!block) return null
  return blockStarted(state) ? turnSlot(block.blockKey, state.turnSeq + 1) : startSlot(block.blockKey)
}

export function buildPageStudyView(state: PageStudyState): PageStudyView {
  const block = currentBlock(state)
  const cov = coverageOf(state)
  const names = Object.fromEntries(state.plan.materials.map(m => [m.materialId, m.name]))
  return {
    planId: state.planId, revision: state.revision, turnSeq: state.turnSeq, finished: isFinished(state),
    block: block ? { blockKey: block.blockKey, materialId: block.materialId, materialName: names[block.materialId] || block.materialId, pageStart: block.start, pageEnd: block.end, index: block.index, total: state.plan.blocks.length } : null,
    coverage: { blockPct: cov.block.pct, planPct: cov.plan.pct, pagesDone: cov.plan.pagesDone, pagesTotal: cov.plan.pagesTotal, conceptsChecked: cov.concepts.checked, conceptsTaught: cov.concepts.taught },
    pending: state.pending ? { format: state.pending.format } : null,
    carryoverDue: state.carryover.filter(c => c.checks < 3).length,
    nextSlot: nextSlotOf(state),
    materials: state.plan.materials.map(m => {
      const blocks = state.plan.blocks.filter(b => b.materialId === m.materialId)
      return { materialId: m.materialId, name: m.name, blocksDone: blocks.filter(b => state.progress[b.blockKey]?.status === 'done').length, blocksTotal: blocks.length, current: block?.materialId === m.materialId }
    }),
  }
}
