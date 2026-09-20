import { createHash } from 'node:crypto'

/**
 * Durable identity definitions for Page Study. Pure and deterministic; storage comes in a later phase.
 *
 *   PageStudyPlan  → pstudy_plan:<sha>      (user + tema + planKey; same PDFs + same initial selection = same plan)
 *   authority batch→ pstudy_batch:<sha>     (plan + batch index; frozen at creation)
 *   material       → (batchId, materialId)
 *   block          → `${materialId}:${start}-${end}`
 *   turn           → slot `pstudy:<blockKey>:<turnSeq>` → record id pstudy_turn:<sha>
 *
 * A turn identity is a SEQUENTIAL SLOT, not a client-generated id: a double submit of the same slot maps to the same
 * durable record (same payload → same result, different payload → conflict, stale slot → refresh).
 */
export const sha256 = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')

export const planKeyOf = (materials: ReadonlyArray<{ materialId: string; selectedPages: readonly number[] }>): string =>
  sha256([...materials].map(m => [m.materialId, [...m.selectedPages]] as const).sort((a, b) => a[0].localeCompare(b[0])))

export const planIdOf = (userId: string, temaId: string, planKey: string): string => `pstudy_plan:${sha256([userId, temaId, planKey])}`
export const batchIdOf = (planId: string, index: number): string => `pstudy_batch:${sha256([planId, index])}`
export const blockKeyOf = (materialId: string, start: number, end: number): string => `${materialId}:${start}-${end}`

export const startSlot = (blockKey: string): string => `pstudy:${blockKey}:start`
export const turnSlot = (blockKey: string, turnSeq: number): string => `pstudy:${blockKey}:${turnSeq}`
export const turnRecordId = (userId: string, planId: string, slot: string): string => `pstudy_turn:${sha256([userId, planId, slot])}`
export const stateRecordId = (userId: string, planId: string): string => `pstudy_state:${sha256([userId, planId])}`
/** Listing scope shared by all turn records of one plan (lets a restore read the log in order). */
export const turnScopeOf = (userId: string, planId: string): string => `pstudy_turns:${sha256([userId, planId])}`
export const ID_PATTERNS = {
  state: /^pstudy_state:[a-f0-9]{64}$/, turn: /^pstudy_turn:[a-f0-9]{64}$/, plan: /^pstudy_plan:[a-f0-9]{64}$/, batch: /^pstudy_batch:[a-f0-9]{64}$/,
} as const
