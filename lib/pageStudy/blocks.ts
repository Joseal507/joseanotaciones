import { canonicalizeSelectedPages } from '../adaptive/sourceSelection'
import { blockKeyOf } from './identity'
import type { AuthorityBatch, BlockPlan, PlanMaterial } from './types'
import { batchOfMaterial } from './batching'

export const DEFAULT_BLOCK_SIZE = 15
export const MIN_BLOCK_SIZE = 1
export const MAX_BLOCK_SIZE = 50

export function normalizeBlockSize(value: unknown): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= MIN_BLOCK_SIZE && n <= MAX_BLOCK_SIZE ? n : DEFAULT_BLOCK_SIZE
}

/** Splits one material's studyable pages into consecutive blocks of `blockSize` pages (page SETS: sparse selections are fine). */
export function planMaterialBlocks(materialId: string, pages: readonly number[], blockSize: number, batchIndex: number, firstIndex: number): BlockPlan[] {
  const sorted = canonicalizeSelectedPages([...pages])
  const size = normalizeBlockSize(blockSize)
  const blocks: BlockPlan[] = []
  for (let offset = 0; offset < sorted.length; offset += size) {
    const chunk = sorted.slice(offset, offset + size)
    blocks.push({ blockKey: blockKeyOf(materialId, chunk[0], chunk[chunk.length - 1]), materialId, batchIndex, index: firstIndex + blocks.length, pages: chunk, start: chunk[0], end: chunk[chunk.length - 1] })
  }
  return blocks
}

/** The single ordered block list of the whole plan: PDF by PDF, page block by page block. */
export function planAllBlocks(materials: readonly PlanMaterial[], universe: Record<string, number[]>, batches: readonly AuthorityBatch[], blockSize: number): BlockPlan[] {
  const blocks: BlockPlan[] = []
  for (const material of materials) {
    const batch = batchOfMaterial(batches, material.materialId)
    if (!batch) throw new Error('PAGE_STUDY_MATERIAL_WITHOUT_BATCH')
    blocks.push(...planMaterialBlocks(material.materialId, universe[material.materialId] || [], blockSize, batch.index, blocks.length))
  }
  return blocks
}

/** Scope can only NARROW what was analysed: pages outside the current universe are ignored, never added. */
export function narrowUniverse(universe: readonly number[], scope: { upTo?: number; ranges?: Array<[number, number]> }): number[] {
  return universe.filter(page => {
    if (scope.upTo !== undefined && page > scope.upTo) return false
    if (scope.ranges?.length) return scope.ranges.some(([from, to]) => page >= from && page <= to)
    return true
  })
}
