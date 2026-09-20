import { buildSourceSelectionSnapshot, canonicalizeSelectedPages } from '../adaptive/sourceSelection'
import { batchIdOf } from './identity'
import type { AuthorityBatch, PlanMaterial } from './types'

/**
 * One visible plan, many internal authority batches.
 *
 * The certified source-selection contract (max 5 materials per snapshot / Enjoyer / Free / Adaptive) is NOT touched:
 * `buildSourceSelectionSnapshot` still truncates at 5. Page Study never hands it more than 5 — it cuts the ordered
 * queue into contiguous batches first and asserts that each snapshot kept every material it was given, so a sixth
 * material can never be silently dropped.
 */
export const AUTHORITY_BATCH_MAX = 5
export const PLAN_MATERIAL_MAX = 40

export function normalizePlanMaterials(input: ReadonlyArray<{ materialId?: unknown; id?: unknown; name?: unknown; selectedPages?: unknown }>): PlanMaterial[] {
  const seen = new Set<string>()
  const out: PlanMaterial[] = []
  for (const raw of input) {
    const materialId = String(raw.materialId ?? raw.id ?? '').trim()
    if (!materialId || seen.has(materialId)) continue
    seen.add(materialId)
    out.push({ materialId, name: String(raw.name ?? materialId).trim() || materialId, selectedPages: canonicalizeSelectedPages(raw.selectedPages) })
  }
  if (out.length > PLAN_MATERIAL_MAX) throw new Error('PAGE_STUDY_TOO_MANY_MATERIALS')
  return out
}

export function buildAuthorityBatches(planId: string, materials: readonly PlanMaterial[]): AuthorityBatch[] {
  const batches: AuthorityBatch[] = []
  for (let start = 0; start < materials.length; start += AUTHORITY_BATCH_MAX) {
    const chunk = materials.slice(start, start + AUTHORITY_BATCH_MAX)
    const selection = buildSourceSelectionSnapshot(chunk.map(m => m.materialId), Object.fromEntries(chunk.map(m => [m.materialId, m.selectedPages])))
    if (selection.materialIds.length !== chunk.length || chunk.some((m, i) => selection.materialIds[i] !== m.materialId)) {
      throw new Error('PAGE_STUDY_BATCH_TRUNCATED') // never let the certified 5-cap silently drop a material
    }
    batches.push({ batchId: batchIdOf(planId, batches.length), index: batches.length, materialIds: chunk.map(m => m.materialId), selection })
  }
  return batches
}

export function batchOfMaterial(batches: readonly AuthorityBatch[], materialId: string): AuthorityBatch | null {
  return batches.find(batch => batch.materialIds.includes(materialId)) ?? null
}
