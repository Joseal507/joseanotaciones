import type { MaterialBrainChunkCheckpoint, MaterialBrainChunkCheckpointStatus } from './types'

// ============================================================
// Stale-write protection (P0 resilience, Phase 19). A checkpoint
// record is never blindly overwritten wholesale — every leaf is
// merged individually by status precedence, so a slower/stale writer
// can never downgrade a leaf another writer already completed.
// ============================================================

const STATUS_PRECEDENCE: Record<MaterialBrainChunkCheckpointStatus, number> = {
  complete: 3,
  complete_no_content: 2,
  retryable_failed: 1,
  terminal_failed: 0,
}

/** True when `incoming` is allowed to replace `existing` for the same leaf id. */
export function checkpointTakesPrecedence(
  incoming: MaterialBrainChunkCheckpoint, existing: MaterialBrainChunkCheckpoint | undefined,
): boolean {
  if (!existing) return true
  return STATUS_PRECEDENCE[incoming.status] >= STATUS_PRECEDENCE[existing.status]
}

/**
 * Merges two checkpoint records leaf-by-leaf. `complete` always wins
 * over `retryable_failed`/`terminal_failed`/`pending` (absent), no
 * matter which record is "newer" — a stale retryable write can NEVER
 * downgrade an already-complete leaf.
 */
export function mergeCheckpointRecords(
  base: Record<string, MaterialBrainChunkCheckpoint> | undefined,
  incoming: Record<string, MaterialBrainChunkCheckpoint> | undefined,
): Record<string, MaterialBrainChunkCheckpoint> {
  const merged: Record<string, MaterialBrainChunkCheckpoint> = { ...(base || {}) }
  for (const [id, incomingCheckpoint] of Object.entries(incoming || {})) {
    if (checkpointTakesPrecedence(incomingCheckpoint, merged[id])) merged[id] = incomingCheckpoint
  }
  return merged
}
